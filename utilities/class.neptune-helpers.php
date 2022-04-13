<?php

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
        $curl = curl_init(self::NEPTUNE_API_URL . $url);
        curl_setopt($curl, CURLOPT_POST, true);
        curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($data));
        curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($curl, CURLOPT_HTTPHEADER, array('Content-Type: application/json'));
        curl_setopt($curl, CURLOPT_SSL_VERIFYPEER, 0);
        $response = curl_exec($curl);
        curl_close($curl);
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
        return file_get_contents(self::NEPTUNE_API_URL . $url);
    }

    /*
    public static function httpHead($url)
    {
        $curl = curl_init(self::NEPTUNE_API_URL . $url);
        curl_setopt($curl, CURLOPT_CUSTOMREQUEST, "HEAD");
        curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($curl, CURLOPT_SSL_VERIFYPEER, 0);
        $response = curl_exec($curl);
        return curl_getinfo($curl,CURLINFO_HTTP_CODE);
        curl_close($curl);
    }

    */

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
        $curl = curl_init(self::NEPTUNE_API_URL . $url);
        curl_setopt($curl, CURLOPT_CUSTOMREQUEST, "DELETE");
        curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($curl, CURLOPT_SSL_VERIFYPEER, 0);
        $response = curl_exec($curl);
        curl_close($curl);
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
}
