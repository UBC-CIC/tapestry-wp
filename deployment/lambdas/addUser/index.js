/*
* Request Type: POST
* Request Body {
*   id - User id
*   roles - roles of the user
* }
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

async function query(id,roles) {
  var result = g.V().hasLabel('user').has('userId',id).count().choose(__.is(0),__.addV('user').property('userId',id),__.V().hasLabel('user').has('userId',id)).next()
  // Handle roles
  if(roles && roles.length != 0){
    await result;
    var promises = [];
    for(var i in  roles){
      var role = roles[i];
      promises.push(
        // Create role node if it does not exist and then create a has_role edge to it if it does not exist.  
        g.V().hasLabel('user').has('userId',id).outE('has_role').where(__.inV().has('name',role)).count()
        .choose(__.is(0),__.addE('has_role').from_(__.V().hasLabel('user').has('userId',id)).to(__.V().hasLabel('role').has('name',role).count().choose(__.is(0),__.addV(role).property('name',role),__.V().hasLabel('role').has('name',role))),
        __.V().hasLabel('user').has('userId',id).outE('has_role').where(__.inV().has('name',role)))
        .next()
      );
    }
    return Promise.all(promises);
  }
  return result;
}

async function doQuery(id,roles) {
  if(id){
    let result = await query(id,roles);
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
      var request = JSON.parse(event.body);
      var result = await doQuery(request.id, request.roles);
      if(result){
          return {
            statusCode: 200,
            body: JSON.stringify(result)
          };
      }
      return {
        statusCode: 400,
        body: JSON.stringify("Bad request")
      }
    })
};