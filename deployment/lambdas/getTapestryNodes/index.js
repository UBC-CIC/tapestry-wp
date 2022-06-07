/**
 * The following is the Lambda function set-up for the Gremlin-Lambda combination,
 * as recommended by AWS Documentation: https://docs.aws.amazon.com/neptune/latest/userguide/lambda-functions-examples.html
 * All changes involving interaction with gremlin should be done in the query async method.
 */

/**
 * GET Request
 * Required in request query string parameters:
 * id: id of the tapestry
 * userId: user id of the user requesting the tapestry
 * roles: user roles encoded in base64
 */
const gremlin = require('gremlin');
const async = require('async');
const {getUrlAndHeaders} = require('gremlin-aws-sigv4/lib/utils');

const traversal = gremlin.process.AnonymousTraversalSource.traversal;
const DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;
const t = gremlin.process.t;
const __ = gremlin.process.statics;
const p = gremlin.process.P;

let conn = null;
let g = null;

async function query(id,userId,roles) {
  // Converting roles to array.
  var buffer = new Buffer(roles,'base64');
  var jsonRoles = buffer.toString('ascii');
  roles = JSON.parse(jsonRoles);
  roles = roles ? roles : [];
  var timeNow = new Date().getTime(); // Current time to check fulfillment of conditions
  var rootId = g.V().hasLabel('tapestry').hasId(id).values('rootId').next(); // Getting root id
  var author = g.V().hasLabel('tapestry').hasId(id).values('author').next(); // Getting author
  // Getting all edges formatted as {source:<node-id>, target:<node-id>}
  var edges = g.V(id).out('contains').outE('connected_to').project('source','target').by(__.outV().id()).by(__.inV().id()).fold().next();
  // Returns only filtered nodes
  var unlockedNodes;
  // Adding roles based on login status
  if(userId == '0')
    roles.push('public')
  else roles.push('authenticated')
  /* The following query does a traversal similar to a depth-first search and returns all nodes that are not locked upon
    tapestry load. This includes all nodes that a user can edit and all nodes that are both viewable and unlocked (based on condition).
    The search traverses edge bidirectionally, so a node will be visited even if it does not have any incoming edges
    if it has at least one outgoing edge to the unlocked graph component.*/
  unlockedNodes = g.V(id)
        // Kind of a while loop that goes on until there are nodes to traverse
        .repeat(__.choose(__.hasLabel('tapestry'),__.outE('contains').has('root','true').inV(),__.both('connected_to')).simplePath()
        /* *** This is the filter portion of the loop. All nodes that do not meet the criteria below get dropped *** */
        // First, we filter nodes out by the user's ability to view them based on it's permissions and the roles it has
        .where(__.inE('user_data').where(__.outV().has('userId',userId)).has('can_view','true').or()
        .inE('role_has_permissions').where(__.outV().has('name',p.within(roles))).has('can_view','true'))
        // Next, we filter the remaining nodes. We keep only those nodes that either have edit permission for the user or the role
        // or are unlocked based on the conditions they have.
        .where(__.inE('user_data').where(__.outV().has('userId',userId)).has('can_edit','true').or()
        .inE('role_has_permissions').where(__.outV().has('name',p.within(roles))).has('can_edit','true').or()
        // checking conditions
        .out('has_condition').as('condition')
        .where(__.choose(__.values('type'))
        .option('node_completed',__.select('condition').out('to_be_completed').inE('user_data').where(__.outV().has('userId',userId)).has('percent_completed','0.0')
        .or().select('condition').out('to_be_completed').inE('user_data').where(__.outV().has('userId',userId)).count().is(0)) // No user_data edge exists
        .option('date_passed',__.select('condition').values('timeStamp').is(p.gte(timeNow)))
        .option('date_not_passed',__.select('condition').values('timeStamp').is(p.lte(timeNow)))
        ).count().is(0)) // number of unfullfilled conditons is 0
        /* *** Filter ends *** */
        .as('nodes')).emit().until(__.select('nodes').count().is(0)).dedup() // simplePath returns unique paths not unique nodes
        .project('nodeId','object').by(__.id()).by(__.valueMap()).fold().next(); // nodes returned formatted as {nodeId: <nodeId>, object: <nodeObject>}
  /*
  The next query fetches all viewable nodes, including locked nodes. It contains all of the above nodes as well.
  It also returns the userProgress for each user corresponding to the node.
  */      
  var viewAbleNodes = g.V(id).out('contains')
                      .where(__.inE('user_data').where(__.outV().has('userId',userId)).has('can_view','true').or()
                      .inE('role_has_permissions').where(__.outV().has('name',p.within(roles))).has('can_view','true'))
                      .project('nodeId','object','progress').by(__.id()).by(__.valueMap())
                      .by(__.choose(__.inE('user_data').where(__.outV().has('userId',userId)).count().is(0),
                      __.constant(0),__.inE('user_data').where(__.outV().has('userId',userId)).values('percent_completed')))
                      .fold().next(); // returns nodes fromatted as {nodeId: <nodeId>, object: <nodeObject>, userProgress: <progress (float)>}
  return [rootId,author,unlockedNodes,viewAbleNodes,edges];
}

async function doQuery(id,userId,roles) {
  let result = await query(id,userId,roles);
  return Promise.all(result);
}



exports.handler = async (event, context) => {

  const getConnectionDetails = () => {
    if (process.env['USE_IAM'] == 'true'){
       return getUrlAndHeaders(
         process.env['NEPTUNE_ENDPOINT'],
         process.env['NEPTUNE_PORT'],
         {},
         '/gremlin',
         'wss'); 
    } else {
      const database_url = 'wss://' + process.env['NEPTUNE_ENDPOINT'] + ':' + process.env['NEPTUNE_PORT'] + '/gremlin';
      return { url: database_url, headers: {}};
    }    
  };


  const createRemoteConnection = () => {
    const { url, headers } = getConnectionDetails();

    const c = new DriverRemoteConnection(
      url, 
      { 
        mimeType: 'application/vnd.gremlin-v2.0+json', 
        headers: headers 
      });  

     c._client._connection.on('close', (code, message) => {
         console.info(`close - ${code} ${message}`);
         if (code == 1006){
           console.error('Connection closed prematurely');
           throw new Error('Connection closed prematurely');
         }
       });  

     return c;     
  };

  const createGraphTraversalSource = (conn) => {
    return traversal().withRemote(conn);
  };

  if (conn == null){
    console.info("Initializing connection")
    conn = createRemoteConnection();
    g = createGraphTraversalSource(conn);
  }
  
  // Changes edge.source and edge.target format from "node-x" to "x" for use by the plugin code.
  // Filters out edges not in the viewable nodes list
  const sanitizeEdges = (edges,nodes) => {
    for(var i = 0; i<edges.length; i++){
      edges[i].source = edges[i].source.substring(5);
      edges[i].target = edges[i].target.substring(5);
    }
    var nodeIds = Object.keys(nodes);
    edges = edges.filter((edge) => {
      return nodeIds.includes(edge.source) && nodeIds.includes(edge.target);
    });
    return edges;
  }
  // Uses the list of unlocked and viewable nodes to form a single map of nodes (nodeId ---> nodeObject) each marked as locked or unlocked
  // Also returns another map of userProgress (nodeId ---> userProgress)
  const formNodeListAndUserProgress = (unlockedObjects,viewableObjects) => {
    var map = {};
    var mapUserProgress = {};
    for(var i = 0; i<unlockedObjects.length; i++){
      unlockedObjects[i].object.accessible = true;
      map[unlockedObjects[i].nodeId.substring(5)] = unlockedObjects[i].object;
    }
    for(var i = 0; i<viewableObjects.length; i++){
      // Logic: Viewable - Unlocked = Locked
      if(!map[viewableObjects[i].nodeId.substring(5)]){
        viewableObjects[i].object.accessible = false;
        map[viewableObjects[i].nodeId.substring(5)] = viewableObjects[i].object;
        mapUserProgress[viewableObjects[i].nodeId.substring(5)] = {
          progress: parseFloat(viewableObjects[i].progress),
        }
      } else {
        mapUserProgress[viewableObjects[i].nodeId.substring(5)] = {
          progress: parseFloat(viewableObjects[i].progress)
        }
      }
    }
    return [map,mapUserProgress];
  }

  return async.retry(
    { 
      times: 5,
      interval: 1000,
      errorFilter: function (err) { 

        // Add filters here to determine whether error can be retried
        console.warn('Determining whether retriable error: ' + err.message);

        // Check for connection issues
        if (err.message.startsWith('WebSocket is not open')){
          console.warn('Reopening connection');
          conn.close();
          conn = createRemoteConnection();
          g = createGraphTraversalSource(conn);
          return true;
        }

        // Check for ConcurrentModificationException
        if (err.message.includes('ConcurrentModificationException')){
          console.warn('Retrying query because of ConcurrentModificationException');
          return true;
        }

        // Check for ReadOnlyViolationException
        if (err.message.includes('ReadOnlyViolationException')){
          console.warn('Retrying query because of ReadOnlyViolationException');
          return true;
        }

        return false; 
      }

    }, 
    async ()=>{
      var result = await doQuery(event.queryStringParameters.id,event.queryStringParameters.userId,
      event.queryStringParameters.roles);
      var [nodes,userProgress] = formNodeListAndUserProgress(result[2].value,result[3].value);
      // returning everything
      if(result[0].value){
        return {
          statusCode: 200,
          body: JSON.stringify({
          rootId: result[0].value.substring(5),
          author: result[1].value,
          nodes: nodes,
          userProgress: userProgress,
          links: sanitizeEdges(result[4].value,nodes),
        })
      }
      }
      return {
        statusCode: 404,
        body: JSON.stringify("Tapestry not found :(")
      }
    })
};