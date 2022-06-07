/**
 * The following is the Lambda function set-up for the Gremlin-Lambda combination,
 * as recommended by AWS Documentation: https://docs.aws.amazon.com/neptune/latest/userguide/lambda-functions-examples.html
 * All changes involving interaction with gremlin should be done in the query async method.
 */

/**
 * POST Request
 * Required in request body:
 * - Any property to be added/updated in the tapestry_node including conditions and permissions
 *   in base64
 */

const gremlin = require('gremlin');
const async = require('async');
const {getUrlAndHeaders} = require('gremlin-aws-sigv4/lib/utils');

const traversal = gremlin.process.AnonymousTraversalSource.traversal;
const DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;
const t = gremlin.process.t;
const __ = gremlin.process.statics;
const { cardinality: { single } } = gremlin.process;  // required to ensure single cardinality of each attribute

let conn = null;
let g = null;

async function query(request) {
  console.log(request);
  if(request.id != undefined){
      var query = `g.V(request.id)`
      var properties = Object.keys(request);
      for(var i in properties){
        if(properties[i] != "id"){
            // Forming query to update nodes. The keyword single ensures the cardinality of the properties to remain single
            query = query + `.property(single,\'${properties[i]}\',\'${request[properties[i]]}\')`;
        }    
      }
      query = query + '.next()';
      var promises = [eval(query)];
      if(request.permissions)
        // Updating permissions
        promises.push(updatePermissions(request));
      if(request.conditions)  
        // Updating Conditions
        promises.push(updateConditions(request));
      return Promise.all(promises);
  }
}

async function updatePermissions(request){
  var buffer = new Buffer(request.permissions,'base64');
  var jsonPermissions = buffer.toString('ascii')
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
        // Create user if it does not exist
        await g.V().hasLabel('user').has('userId',userId).count().choose(__.is(0),__.addV('user').property('userId',userId),__.V().hasLabel('user').has('userId',userId))
        .outE('user_data').where(__.inV().id().is(request.id)).count()
        // Create user_data edge if it does not exist and selects it
        .choose(__.is(0),__.addE('user_data').from_(__.V().hasLabel('user').has('userId',userId)).to(__.V(request.id)).property('percent_completed','0.0'),
        __.V(request.id).inE('user_data').where(__.outV().has('userId',userId)))
        // Add properties
        .property('can_edit', can_edit.toString()).property('can_add',can_add.toString())
        .property('can_view',can_view.toString()).property('tapestry_id',request.tapestry_id).next();
    }
    else {
      var role = usersAndRoles[i];
        await g.V().hasLabel('role').has('name',role).count().choose(__.is(0),
        // Role does not exist
        __.addV('role').property('name',role),
        // Role exists
        __.V().hasLabel('role').has('name',role)
        ).outE('role_has_permissions').where(__.inV().id().is(request.id)).count().choose(__.is(0),
        // Edge does not exist
        __.addE('role_has_permissions').from_(__.V().hasLabel('role').has('name',role)).to(__.V(request.id)),
        // Edge exists
        __.V(request.id).inE('role_has_permissions').where(__.outV().has('name',role))
        ).property('can_edit', can_edit.toString()).property('can_add',can_add.toString())
        .property('can_view',can_view.toString()).property('tapestry_id',request.tapestry_id).next();
    }
  }
  return;
}

async function updateConditions(request){
  var buffer = new Buffer(request.conditions,'base64');
  var jsonConditions = buffer.toString('ascii')
  var conditions = JSON.parse(jsonConditions);
  // First remove all conditions from the node
  await g.V(request.id).out('has_condition').drop().next();
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
              body: "Update Successful!"
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