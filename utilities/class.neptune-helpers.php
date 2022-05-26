<?php

require_once dirname(__FILE__).'/../classes/class.tapestry-node.php';

class NeptuneHelpers
{
    const NEPTUNE_API_URL = 'https://qqj4bz0cg9.execute-api.ca-central-1.amazonaws.com/default/';
    

    /**
    * Make a HTTP POST request to Neptune APIs.
    *
    * @param string $url Request URL
    *
    * @param object $data POST request object
    *
    * @return object HTTP response
    */
    public static function httpPost($url, $data)
    {
        $start = microtime(true);
        $curl = curl_init(self::NEPTUNE_API_URL . $url);
        curl_setopt($curl, CURLOPT_POST, true);
        curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($data));
        curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($curl, CURLOPT_HTTPHEADER, array('Content-Type: application/json'));
        curl_setopt($curl, CURLOPT_SSL_VERIFYPEER, 0);
        $response = curl_exec($curl);
        curl_close($curl);
        error_log("POST " . $url . " " . (microtime(true)-$start));
        return $response;
    }

    /**
     * Make a HTTP GET request to Neptune APIs.
     *
     * @param string $url Request URL
     *
     * @return object HTTP response
     */
    public static function httpGet($url)
    {
        $start = microtime(true);
        $contents = file_get_contents(self::NEPTUNE_API_URL . $url);
        error_log("GET " . $url . " " . (microtime(true)-$start));
        return $contents;
    }


    /**
    * Make a HTTP DELETE request to Neptune APIs.
    *
    * @param string $url Request URL 
    *
    * @param object $data POST request object
    *
    * @return object HTTP response
    */

    public static function httpDelete($url)
    {
        $start = microtime(true);
        $curl = curl_init(self::NEPTUNE_API_URL . $url);
        curl_setopt($curl, CURLOPT_CUSTOMREQUEST, "DELETE");
        curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($curl, CURLOPT_SSL_VERIFYPEER, 0);
        $response = curl_exec($curl);
        curl_close($curl);
        error_log("DELETE " . $url . " " . (microtime(true)-$start));
        return $response;
    }

    /**
     * Convert array of node IDs from string IDs to int IDs (MUTATES the original array)
     * 
     * @param $nodes Array of node IDs
     */

    public static function convertNodesToInt(&$nodes){
        for($i = 0; $i<count($nodes); $i++){
            $nodes[$i] = intval($nodes[$i]);
        }
    }

    /**
     * Convert array of links from string IDs to int IDs (MUTATES the original array)
     * 
     * @param $links Array of node IDs
     */

    public static function convertLinksToInt(&$links){
        for($i = 0; $i<count($links); $i++){
            $links[$i]->source = intval($links[$i]->source);
            $links[$i]->target = intval($links[$i]->target);
        }
    }

    /**
     * Converts array that maps postId (string) -> postId (string) to postId (string) -> postId (int)
     * 
     * @param $links Array of node IDs
     */

    public static function convertPostIdsToInt($postIds){
        $intArray = [];
        foreach($postIds as $key=>$value){
            $intArray[$key] = intval($value);
        }
        return $intArray;
    }

    
    public static function convertObjectsToArr($nodeObjects,$tapestryPostId){
        $nodeArray = [];
        foreach($nodeObjects as $key=>$value){
            self::sanitizeNodeObject($value,$key);
            //$node = new TapestryNode($tapestryPostId,intval($key),true);
            //$node->set($value);
            $nodeArray[intval($key)] = $value;
        }
        return $nodeArray;
    }

    public static function getRolesAsString($userId){
        $user = get_userdata($userId);

        return base64_encode(json_encode($user->roles));
    }

    private static function sanitizeNodeObject(&$object,$key){
        $object->id = intval($key);
        $object->fitWindow = $object->fitWindow[0] == 'true';
        $object->lockedImageURL = $object->lockedImageURL[0];
        $object->description = base64_decode($object->description[0]);
        $object->mediaFormat = $object->mediaFormat[0];
        $object->type = $object->type[0];
        $object->title = $object->title[0];
        $object->presentationStyle = $object->presentationsStyle[0];
        $object->permissions = json_decode(base64_decode($object->permissions[0]));
        $object->imageURL = $object->imageURL[0];
        $object->hideProgress = $object->hideProgress[0] == "true";
        $object->coordinates = (object) array("x" => floatval($object->coordinates_x[0]), "y" => floatval($object->coordinates_y[0]));
        $object->hideMedia = $object->hideMedia[0] == "true";
        $object->backgroundColor = $object->backgroundColor[0];
        $object->author = json_decode(base64_decode($object->author[0]));
        $object->mediaType = $object->mediaType[0];
        $object->skippable = $object->skippable[0] == "true";
        $object->textColor = $object->textColor[0];
        if (property_exists($object, 'popup')) {
            $object->popup = $object->popup[0];
        }
        $object->size = $object->size[0];
        $object->fullscreen = $object->fullscreen[0] == "true";
        $object->hideTitle = $object->hideTitle[0] == "true";
        $object->lockedThumbnailFileId = $object->lockedThumbnailFileId[0];
        $object->mediaDuration = intval($object->mediaDuration[0]);
        $object->behaviour = $object->behaviour[0];
        $object->reviewStatus = $object->reviewStatus[0];
        $object->data_post_id = intval($object->data_post_id[0]);
        $object->conditions = json_decode(base64_decode($object->conditions[0]));
        $object->thumbnailFileId = $object->thumbnailFileId[0];
        $object->status = $object->status[0];
        if (property_exists($object, 'mapCoordinates_lat')) {
            $object->mapCoordinates = (object) array("lat" => floatval($object->mapCoordinates_lat[0]), "lng" => floatval($object->mapCoordinates_lng[0]));
        }
        $object->unlocked = $object->accessible;
        $object->accessible = $object->accessible;
        $object->typeData = new stdClass();
        $object->childOrdering = array_map(function ($n) {
            return intval($n);
        },json_decode(base64_decode($object->childOrdering[0])));
    }


}
