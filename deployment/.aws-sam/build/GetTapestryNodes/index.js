/*
* Request Type: GET
* Query String Parameters: id - id of the 
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
  var buffer = new Buffer(roles,'base64');
  var jsonRoles = buffer.toString('ascii');
  roles = JSON.parse(jsonRoles);
  roles = roles ? roles : [];
  var timeNow = new Date().getTime();
  var rootId = g.V().hasLabel('tapestry').hasId(id).values('rootId').next();
  var author = g.V().hasLabel('tapestry').hasId(id).values('author').next();
  var edges = g.V(id).out('contains').outE('connected_to').project('source','target').by(__.outV().id()).by(__.inV().id()).fold().next();
  // Returns only filtered nodes
  var unlockedNodes;
  if(userId == '0')
    roles.push('public')
  else roles.push('authenticated')
  unlockedNodes = g.V(id)
        .repeat(__.choose(__.hasLabel('tapestry'),__.outE('contains').has('root','true').inV(),__.both('connected_to')).simplePath()
        // Filter here
        .where(__.inE('user_data').where(__.outV().has('userId',userId)).has('can_view','true').or()
        .inE('role_has_permissions').where(__.outV().has('name',p.within(roles))).has('can_view','true'))
        .where(__.inE('user_data').where(__.outV().has('userId',userId)).has('can_edit','true').or()
        .inE('role_has_permissions').where(__.outV().has('name',p.within(roles))).has('can_edit','true').or()
        .out('has_condition').as('condition')
        .where(__.choose(__.values('type'))
        .option('node_completed',__.select('condition').out('to_be_completed').inE('user_data').where(__.outV().has('userId',userId)).has('percent_completed','0.0')
        .or().select('condition').out('to_be_completed').inE('user_data').where(__.outV().has('userId',userId)).count().is(0)) // No user_data edge exists
        .option('date_passed',__.select('condition').values('timeStamp').is(p.gte(timeNow)))
        .option('date_not_passed',__.select('condition').values('timeStamp').is(p.lte(timeNow)))
        ).count().is(0))
        .as('nodes')).emit().until(__.select('nodes').count().is(0)).dedup()
        .project('nodeId','object').by(__.id()).by(__.valueMap()).fold().next();
  var viewAbleNodes = g.V(id).out('contains')
                      .where(__.inE('user_data').where(__.outV().has('userId',userId)).has('can_view','true').or()
                      .inE('role_has_permissions').where(__.outV().has('name',p.within(roles))).has('can_view','true'))
                      .project('nodeId','object','progress').by(__.id()).by(__.valueMap())
                      .by(__.choose(__.inE('user_data').where(__.outV().has('userId',userId)).count().is(0),
                      __.constant(0),__.inE('user_data').where(__.outV().has('userId',userId)).values('percent_completed')))
                      .fold().next();
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
  
  const formNodeListAndUserProgress = (unlockedObjects,viewableObjects) => {
    var map = {};
    var mapUserProgress = {};
    for(var i = 0; i<unlockedObjects.length; i++){
      unlockedObjects[i].object.accessible = true;
      map[unlockedObjects[i].nodeId.substring(5)] = unlockedObjects[i].object;
    }
    for(var i = 0; i<viewableObjects.length; i++){
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