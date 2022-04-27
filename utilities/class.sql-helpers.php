<?php

class SqlHelpers
{
    /**
     * Query the relational database to load all node objects at once in the form of an array that maps node ID to node data
     * 
     * @param $postIds array of node Ids of all nodes mapped to the post Ids of their respective tapestry_node_data's post Ids
     * 
     * @return array of TapestryNode objects corresponding to the postIds
     */

     public static function bulkLoadNodesData($postIds)
     {
         global $wpdb;
         $list = self::_formList($postIds);
         if($list == '')
            return [];  
         $query = 'select meta_value from ' . $wpdb->prefix . 'postmeta where post_id in (' . $list . ')';
         error_log($query);
         $result = $wpdb->get_results($query);
         $nodeObjs = [];
         foreach($result as $data){
             $unserialized = unserialize($data->meta_value);
             $nodeObjs[$unserialized->id] = $unserialized;
         }
         return $nodeObjs;
     }

     /**
     * Query the relational database to load all node object meta's at once in the form of an array that maps node ID to node metadata
     * 
     * @param $metaIds array of metaIds of all node_data's in the tapestry
     * 
     * @return array of TapestryNode objects corresponding to the postIds
     */

     public static function bulkLoadNodesMetaData($metaIds){
        global $wpdb;
        $list = self::_formListMeta($metaIds);
        if($list == '')
            return []; 
        $query = 'select meta_value, meta_id from ' . $wpdb->prefix . 'postmeta where meta_id in (' . $list . ')';
        $result = $wpdb->get_results($query);
        $nodeMetaObjs = [];
        foreach($result as $data){
            $id = $data->meta_id;
            $meta = unserialize($data->meta_value);
            $nodeMetaObjs[$id] = $meta;
        }
        return $nodeMetaObjs;
     }

     private static function _formList($postIds){
         if(count($postIds) == 0)
            return '';
         $list = '';
         foreach($postIds as $key=>$value){
            $list = $list . $value . ',';
         }
         return substr($list,0,-1);
     }

     private static function _formListMeta($ids){
        if(count($ids) == 0)
           return '';
        $list = '';
        foreach($ids as $value){
           $list = $list . $value . ',';
        }
        return substr($list,0,-1);
    }
}