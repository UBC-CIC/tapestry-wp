/**
 * The following is the Lambda function set-up for the Gremlin-Lambda combination,
 * as recommended by AWS Documentation: https://docs.aws.amazon.com/neptune/latest/userguide/lambda-functions-examples.html
 * All changes involving interaction with gremlin should be done in the query async method.
 */

/**
 * POST Request
 * Required in request body:
 * - id: Node id, formatted as "node-x" where x is the node->id
 * - tapestry_id: Tapestry post id as string
 * - title: Node title
 * - All other node contents excluding typeData, reviewComments, license, references, popup
 */

const gremlin = require('gremlin');
const async = require('async');
const {getUrlAndHeaders} = require('gremlin-aws-sigv4/lib/utils');

const traversal = gremlin.process.AnonymousTraversalSource.traversal;
const DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;
const t = gremlin.process.t;
const __ = gremlin.process.statics;

let conn = null;
let g = null;

async function query(request) {
  if(request.id != undefined && request.tapestry_id != undefined && request.title != undefined){
      // add node and contains edge from tapestry node to the newly created node
      // forming the query without executing it just yet
      var query =  `g.addE(\'contains\').from_(__.V(request.tapestry_id))
      .to(__.addV(\'tapestry_node\').property(t.id,request.id).property(\'title\',request.title)
      .property(\'coordinates_x\',request.coordinates_x).property(\'coordinates_y\',request.coordinates_y).property(\'data_post_id\',request.data_post_id)
      .property(\'author\',request.author).property(\'conditions\',request.conditions).property(\'permissions\',request.permissions).property(\'mapCoordinates_lat\',request.mapCoordinates_lat)
      .property(\'mapCoordinates_lng\',request.mapCoordinates_lng).property(\'description\',request.description).property(\'childOrdering\',request.childOrdering)`;
      var nodeData = request.nodeData;
      if(nodeData){
        var properties = Object.keys(nodeData);
        for(var i in properties){
          // adding all other properties to the node
          query = query + `.property(\'${properties[i]}\',\'${nodeData[properties[i]]}\')`;
        }  
      }
      // Mark contains edge as root if the node is root node
      query = query+').choose(__.V(request.tapestry_id).values(\'rootId\').is(request.id),__.property(\'root\',\'true\'),__.property(\'root\',\'false\')).next()';
      var propertiesAdded = await eval(query);
      // add user_data edge
      var userSync = await addPermissions(request);
      // add conditions if any
      var conditionSync = addConditions(request); 
      return Promise.all([propertiesAdded,userSync,conditionSync]);
  }
}

async function addPermissions(request){
  var buffer = new Buffer(request.permissions,'base64');
  var jsonPermissions = buffer.toString('ascii');
  var permissions = JSON.parse(jsonPermissions);
  var usersAndRoles = Object.keys(permissions);
  for(var i = 0; i<usersAndRoles.length; i++){
      var can_add = false;
      var can_edit = false;
      var can_view = false;
      var permList = permissions[usersAndRoles[i]];
      for(var j = 0; j<permList.length; j++){
        if(permList[j] == 'read')
          can_view = true;
        if(permList[j] == 'edit')
          can_edit = true;
        if(permList[j] == 'add')
          can_add = true;
      }
    if(usersAndRoles[i].startsWith('user')){
      var userId = usersAndRoles[i].substring(5);
        // Add a user_data edge to the node from the user's node. If the user node doesn't exist, create it.
        await g.addE('user_data').from_(__.V().hasLabel('user').has('userId',userId).count().choose(__.is(0),__.addV('user').property('userId',userId),__.V().hasLabel('user').has('userId',userId)))
        .to(__.V(request.id))
        // Add properties to the user_data edge
        .property('percent_completed','0.0').property('can_edit', can_edit.toString()).property('can_add',can_add.toString())
        .property('can_view',can_view.toString()).property('tapestry_id',request.tapestry_id).next();
    } else {
      var role = usersAndRoles[i]; 
        // Add a role_has_permissions edge to the node from the role's node. If the role's node doesn't exist, create it. 
        await g.addE('role_has_permissions').from_(__.V().hasLabel('role').has('name',role).count().choose(__.is(0),__.addV('role').property('name',role),__.V().hasLabel('role').has('name',role)))
        .to(__.V(request.id))
        // Add properties to the role_has_permissions edge
        .property('can_edit', can_edit.toString()).property('can_add',can_add.toString())
        .property('can_view',can_view.toString()).property('tapestry_id',request.tapestry_id).next();
    }
  }
  return;
}

async function addConditions(request){
  var buffer = new Buffer(request.conditions,'base64');
  var jsonConditions = buffer.toString('ascii');
  var conditions = JSON.parse(jsonConditions);
  if(conditions.length != 0){
    for(var i = 0; i<conditions.length; i++){
      var condition = conditions[i];
      var promise;
      if(condition.type == 'node_completed'){
        // add node_completed condition
        var newCondition = await g.addE('has_condition').from_(__.V(request.id)).to(__.addV('condition').property('type',condition.type)).inV().id().next();
        promise = g.addE('to_be_completed').from_(__.V(newCondition.value)).to(__.V("node-"+condition.nodeId)).next(); 
      } else if (condition.type == 'date_passed') {
        // add date_passed condition
        var time = convertToUnixTimestamp(condition.date, condition.time, condition.timezone); 
        promise = g.addE('has_condition').from_(__.V(request.id)).to(__.addV('condition').property('type',condition.type).property('timeStamp', time)).next();
      } else if (condition.type == 'date_not_passed') {
        // add date_not_passed condition
        var time = convertToUnixTimestamp(condition.date, condition.time, condition.timezone);
        promise = g.addE('has_condition').from_(__.V(request.id)).to(__.addV('condition').property('type',condition.type).property('timeStamp', time)).next();
      }
      await promise;
    }
    return;
  }
  return;
}

// Converts any time zone's time to a common UNIX timestamp to check if a condition is fulfilled
function convertToUnixTimestamp(date,time,timeZone){
  var dateString = `${date} ${time}`;
  var dateUTC = new Date(dateString);
  return dateUTC.getTime() - getOffset(timeZone,dateUTC);
}

// date required to account for Daylight Savings
function getOffset(timeZone,date){
  var utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  var tzDate = new Date(date.toLocaleString('en-US', { timeZone }));
  return (tzDate.getTime() - utcDate.getTime());
}

async function doQuery(requestJSON) {
  let request = JSON.parse(requestJSON);
  if(request){
      let result = await query(request);
      return result;
  }
  return;
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
      var result = await doQuery(event.body);
      if(result){
          return {
              statusCode: 200,
              body: JSON.stringify(result[0].value)
          }
      }
      else{
          return {
              statusCode: 400,
              body: "Bad Request :"
          }
      }
    })
};