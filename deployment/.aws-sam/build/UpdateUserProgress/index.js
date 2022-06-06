/*
* Request Type: POST
* Request Contents 
* { userId, nodeId, progressValue }
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

async function query(request) {
  console.log(request);
  return g.V(request.nodeId).choose(__.inE('user_data').where(__.outV().has('userId',request.userId)).count().is(0),
  // No user progress exists
  __.addE('user_data').from_(__.V().hasLabel('user').has('userId',request.userId)).to(__.V(request.nodeId)),
  // User progress exists
  __.V(request.nodeId).inE('user_data').where(__.outV().has('userId',request.userId))
  ).property('percent_completed',request.progressValue).property('tapestryId',request.tapestryId).next()
}

async function doQuery(request) {
  if(request){
    var result = query(request);
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
      var result = await doQuery(request);
      if(result.value){
        return {
          statusCode: 200,
          body: JSON.stringify({
          task: `Updated user-${request.userId} progress for ${request.nodeId} to ${request.progressValue}`
        })
      }
      }
      return {
        statusCode: 404,
        body: JSON.stringify("Error updating progress")
      }
    })
};