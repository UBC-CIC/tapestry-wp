<?php

require_once dirname(__FILE__).'/../utilities/class.tapestry-errors.php';
require_once dirname(__FILE__).'/../utilities/class.tapestry-helpers.php';
require_once dirname(__FILE__).'/../utilities/class.tapestry-user.php';
require_once dirname(__FILE__).'/../utilities/class.tapestry-node-permissions.php';
require_once dirname(__FILE__).'/../classes/class.tapestry-user-progress.php';
require_once dirname(__FILE__).'/../classes/class.tapestry-h5p.php';
require_once dirname(__FILE__).'/../classes/class.constants.php';
require_once dirname(__FILE__).'/../interfaces/interface.tapestry.php';
require_once dirname(__FILE__).'/class.constants.php';
require_once dirname(__FILE__).'/../utilities/class.neptune-helpers.php';


/**
 * TODO: Implement group functionality. Currently all the group-related
 * functionality code is commented out.
 */
$currTapestry = null;
/**
 * Add/update/retrieve a Tapestry.
 */
class Tapestry implements ITapestry
{
    private $postId;
    private $author;
    // private $groups;
    private $links;
    private $settings;
    private $rootId;
    private $nodes;
    private $nodeObjects; // Used only in the set up so we don't have to retrieve the nodes from the db multiple times
    private $visitedNodeIds; // Used in _recursivelySetAccessible function

    private $updateTapestryPost = true;

    /**
     * Constructor.
     *
     * @param Number $postId post ID
     *
     * @return null
     */
    public function __construct($postId = 0, $tapestryData = null)
    {
        $this->postId = (int) $postId;
        $this->author = (int) $this->_getAuthor();

        $this->nodes = [];
        $this->links = [];
        // $this->groups = [];
        $this->rootId = 0;
        $this->settings = $this->_getDefaultSettings();

        if (TapestryHelpers::isValidTapestry($this->postId)) {
            if ($tapestryData) {
                $this->set($tapestryData);
            } else {
                $tapestry = $this->_loadFromDatabase();
                $this->set($tapestry);
            }
        }
    }

    /**
     * Save the Tapestry.
     *
     * @return object $tapestry
     */
    public function save()
    {
        $this->updateTapestryPost = true;

        return $this->_saveToDatabase();
    }


    /**
     * Save tapestry settings on the relational database
     *
     * @return object $settings
     */

    public function saveSettings()
    {
        update_post_meta($this->postId, 'tapestry_settings', $this->settings);
        return $this->setiings;
    }

    /**
     * Set Tapestry.
     *
     * @param object $tapestry tapestry
     *
     * @return null
     */
    public function set($tapestry)
    {
        if (isset($tapestry->rootId) && is_numeric($tapestry->rootId)) {
            $this->rootId = $tapestry->rootId;
        }
        if (isset($tapestry->nodes) && is_array($tapestry->nodes)) {
            $this->nodes = $tapestry->nodes;
        }
        // if (isset($tapestry->groups) && is_array($tapestry->groups)) {
        //     $this->groups = $tapestry->groups;
        // }
        if (isset($tapestry->links) && is_array($tapestry->links)) {
            $this->links = $tapestry->links;
        }
        if (isset($tapestry->settings) && is_object($tapestry->settings)) {
            $this->settings = $tapestry->settings;
            if (!isset($this->settings->analyticsEnabled)) {
                $this->settings->analyticsEnabled = false;
            }
            if (!isset($this->settings->draftNodesEnabled)) {
                $this->settings->draftNodesEnabled = true;
                $this->settings->submitNodesEnabled = true;
            }
        }
        if (isset($tapestry->dataPostIds)) {
            $this->dataPostIds = $tapestry->dataPostIds;
        }
        // userProgress is now returned from Neptune
        if (isset($tapestry->userProgress)) {
            $this->userProgress = (array) $tapestry->userProgress;
        }
    }

    /**
     * Retrieve a Tapestry post.
     *
     * @return object $tapestry
     */
    public function get($filterUserId = -1)
    {
        if (!$this->postId) {
            throw new TapestryError('INVALID_POST_ID');
        }
        return $this->_getTapestry($filterUserId);
    }

    /**
     * Get node IDs.
     *
     * @return array $nodes  node ids
     */
    public function getNodeIds()
    {
        if (!$this->postId) {
            throw new TapestryError('INVALID_POST_ID');
        }

        return $this->nodes;
    }

    /**
     * Get links.
     *
     * @return array $links
     */
    public function getLinks()
    {
        if (!$this->postId) {
            throw new TapestryError('INVALID_POST_ID');
        }

        return $this->links;
    }

    /**
     * Add a new node.
     *
     * @param object $node Tapestry node
     *
     * @return object $node   Tapestry node
     */
    public function addNode($node)
    {
        $tapestryNode = new TapestryNode($this->postId);

        // Checks if user is logged in to prevent logged out user-0 from getting permissions
        // Only add user permissions if it is not a review node
        if (is_user_logged_in() && 0 === count($node->reviewComments)) {
            $userId = wp_get_current_user()->ID;
            $node->permissions->{'user-'.$userId} = ['read', 'add', 'edit'];
        }

        $tapestryNode->set($node);
        $node = $tapestryNode->save($node);

        // Neptune portion of the function

        if (empty($this->rootId)) {
            $this->rootId = $node->id;
            $this->addTapestryInNeptune();
        }
        $this->addNodeInNeptune($node);
        return $node;
    }

    /**
     * Delete a node.
     *
     * @param object $nodeId Tapestry node id
     *
     * @return object $Array   Tapestry nodes
     */
    public function deleteNodeFromTapestry($nodeId)
    {
        // Remove the rootId field
        if ($nodeId == $this->rootId) {
            foreach ($this->nodes as $node) {
                if ($node->id !== $this->rootId && !TapestryHelpers::nodeIsDraft($node, $this->postId)) {
                    throw new TapestryError('CANNOT_DELETE_ROOT');
                }
            }
            $this->rootId = 0;
            $this->deleteTapestryInNeptune();
        }
        $this->deleteNodeInNeptune($nodeId);
        

        // Delete condition from nodes that rely on this node
        foreach ($this->nodes as $index => $id) {
            if ($id != $nodeId) {
                // Delete condition from node and update database
                $elementNode = new TapestryNode($this->postId, $id);
                $elementNode->removeConditionsById($nodeId);
            }
        }
        return $this->nodes;
    }

    /**
     * Add a new link.
     *
     * @param object $link Tapestry link
     *
     * @return object $link   Tapestry link
     */
    public function addLink($link)
    {
        array_push($this->links, $link);

        // Neptune portion of the function

        $this->addLinkInNeptune($link);
        return $link;
    }

    /**
     * Reverse a link from links array.
     *
     * @param int $link an array containing the node IDs that this connects
     *
     * @return array $links     Tapestry links
     */
    public function reverseLink($newLink)
    {
        foreach ($this->links as $linkIndex => $link) {
            if ($link->target == $newLink->target && $link->source == $newLink->source) {
                $this->links[$linkIndex]->source = $newLink->target;
                $this->links[$linkIndex]->target = $newLink->source;
                break;
            }
        }

        // Neptune portion of the function

        $this->reverseLinkInNeptune($newLink);
        return $this->links;
    }

    /**
     * Delete a link from links array.
     *
     * @param int $link an array containing the node IDs that this connects
     *
     * @return array $links     Tapestry links
     */
    public function removeLink($linkToDelete)
    {
        foreach ($this->links as $linkIndex => $link) {
            if ($link->source == $linkToDelete->source && $link->target == $linkToDelete->target) {
                array_splice($this->links, $linkIndex, 1);
                break;
            }
        }

        // Neptune portion of the function

        $this->deleteLinkInNeptune($linkToDelete);
        return $this->links;
    }

    /**
     * Add a new group.
     *
     * @param object $group Tapestry group
     *
     * @return object $group   Tapestry group
     */
    public function addGroup($group)
    {
        //     $tapestryGroup = new TapestryGroup($this->postId);
    //     $tapestryGroup->set($group);
    //     $group = $tapestryGroup->save();

    //     array_push($this->groups, $group->id);
    //     $this->_saveToDatabase();

    //     return $group;
    }

    /**
     * Get the node controller with associated node meta ID.
     *
     * @param Number $nodeMetaId node meta ID
     *
     * @return object $node       node controller
     */
    public function getNode($nodeMetaId)
    {
        return new TapestryNode($this->postId, $nodeMetaId);
    }

    /**
     * Get the group controller with associated group meta ID.
     *
     * @param Number $groupMetaId group meta ID
     *
     * @return object $group          group controller
     */
    public function getGroup($groupMetaId)
    {
        // return new TapestryNode($this->postId, $groupMetaId);
    }

    /**
     * Returns true if the tapestry is empty.
     *
     * @return bool true if there is no root node, false otherwise
     */
    public function isEmpty()
    {
        return empty($this->rootId);
    }


    public function getAllContributors()
    {
        $authors = [];
        foreach ($this->nodes as $node) {
            $node = new TapestryNode($this->postId, $node);
            if ($node->isAvailableToUser()) {
                array_push($authors, $node->get()->author);
            }
        }

        return array_unique($authors, SORT_REGULAR);
    }

    /**
     * Retrieve a Tapestry post for export.
     *
     * @return object $tapestry
     */
    public function export()
    {
        $nodes = [];
        foreach ($this->nodes as $node) {
            $temp = (new TapestryNode($this->postId, $node))->get();
            if (NodeStatus::DRAFT == $temp->status) {
                continue;
            }
            $nodes[] = $temp;
        }
        // $groups = [];
        // foreach ($this->groups as $group) {
        //     $groups[] = (new TapestryGroup($this->postId, $$group))->get();
        // }
        $parsedUrl = parse_url($this->settings->permalink);
        unset($this->settings->permalink);
        unset($this->settings->tapestrySlug);
        unset($this->settings->title);
        unset($this->settings->status);

        return (object) [
            'nodes' => $nodes,
            // 'groups' => $groups,
            'links' => $this->links,
            'settings' => $this->settings,
            'site-url' => $parsedUrl['scheme'].'://'.$parsedUrl['host'],
        ];
    }

    private function _loadFromDatabase()
    {
        $tapestry = $this->getTapestryFromNeptune();
        $settings = get_post_meta($this->postId, 'tapestry_settings', true);
        $tapestry->settings = $settings;
        if (empty($tapestry)) {
            return $this->_getDefaultTapestry();
        }
        return $tapestry;
    }

    private function _getDefaultTapestry()
    {
        $tapestry = new stdClass();
        $tapestry->nodes = [];
        $tapestry->links = [];
        // $tapestry->groups = [];
        $tapestry->rootId = 0;
        $tapestry->settings = $this->_getDefaultSettings();

        return $tapestry;
    }

    private function _getDefaultSettings()
    {
        $post = get_post($this->postId);
        $settings = new stdClass();
        $settings->tapestrySlug = $post->post_name;
        $settings->title = $post->post_title;
        $settings->status = $post->post_status;
        $settings->backgroundUrl = '';
        $settings->autoLayout = false;

        $settings->showAccess = true;
        $settings->showRejected = false;
        $settings->showAcceptedHighlight = true;
        $settings->defaultPermissions = TapestryNodePermissions::getDefaultNodePermissions($this->postId);
        $settings->superuserOverridePermissions = true;
        $settings->analyticsEnabled = false;
        $settings->draftNodesEnabled = true;
        $settings->submitNodesEnabled = true;
        $settings->permalink = get_permalink($this->postId);

        return $settings;
    }

    private function _getAuthor()
    {
        if ($this->postId) {
            return get_post_field('post_author', $this->postId);
        } else {
            return wp_get_current_user()->ID;
        }
    }

    private function _formTapestry()
    {
        return (object) [
            'nodes' => $this->nodes,
            // 'groups' => $this->groups,
            'links' => $this->links,
            'settings' => $this->settings,
            'rootId' => $this->rootId,
            'userProgress' => $this->userProgress
        ];
    }

    private function _resetAuthor()
    {
        wp_update_post([
            'ID' => $this->postId,
            'post_author' => $this->author,
        ]);
    }

    private function _getTapestry($filterUserId)
    {
        // Get all the nodes from the database (we will need this info and only want to do it once)
        $tapestry = $this->_formTapestry();
        $tapestry->nodes = $this->_addH5PMeta($tapestry->nodes);
        // $tapestry->groups = array_map(
        //     function ($groupMetaId) {
        //         $tapestryGroup = new TapestryGroup($this->postId, $groupMetaId);

        //         return $tapestryGroup->get();
        //     },
        //     $tapestry->groups
        // );
        $userProgress = new TapestryUserProgress($this->postId);
        $tapestry->userProgress = $userProgress->get($tapestry);
        return $tapestry;
    }


    private function _addH5PMeta($nodes)
    {
        $controller = new TapestryH5P();
        $allH5Ps = $controller->get();
        foreach ($nodes as $i => $node) {
            if ('h5p' == $node->mediaType && $node->typeData->mediaURL) {
                $H5PURLParts = explode('&id=', $node->typeData->mediaURL);
                if (count($H5PURLParts) >= 2) {
                    $H5PId = $H5PURLParts[1];
                    $H5PIndex = array_search($H5PId, array_column($allH5Ps, 'id'));
                    if ($H5PIndex || 0 == $H5PIndex) {
                        $nodes[$i]->typeData->h5pMeta = $allH5Ps[$H5PIndex];
                    }
                }
            }
        }

        return $nodes;
    }

    // Neptune Functions

    // POST Requests

    private function addTapestryInNeptune()
    {
        $data = array(
            'id' => strval($this->postId),
            'author' => $this->author,
            'rootId' => "node-" . strval($this->rootId)
        );
        $response = NeptuneHelpers::httpPost("addTapestry", $data);
    }

    private function addNodeInNeptune($node)
    {
        $nodeData = array();
        // Listing the keys to avoid sending to graph database
        $keyExclusion = array("id","postId","author","title","coordinates","typeData","permissions","license","mapCoordinates",
        "conditions","childOrdering","reviewComments","description");
        foreach ($node as $key => $value) {
            if (!in_array($key, $keyExclusion)) {
                $nodeData[$key] = $value;
            }
        }

        // Base64 encoded : author, permissions
        $data = array(
            'id' => "node-" . strval($node->id),
            'tapestry_id' => strval($this->postId),
            'user_id' => strval(get_current_user_id()),
            'title' => $node->title,
            'coordinates_x' => strval($node->coordinates->x),
            'coordinates_y' => strval($node->coordinates->y),
            'mapCoordinates_lat' => strval($node->mapCoordinates ? $node->mapCoordinates->lat : '0.0'),
            'mapCoordinates_lng' => strval($node->mapCoordinates ? $node->mapCoordinates->lng : '0.0'),
            'data_post_id' => strval($node->postId),
            'author' => strval(base64_encode(json_encode($node->author))),
            'permissions' => base64_encode(json_encode($node->permissions)),
            'conditions' => strval(base64_encode(json_encode($node->conditions))),
            'description' => base64_encode($node->description),
            'childOrdering' => base64_encode(json_encode($node->childOrdering)),
            'nodeData' => $nodeData
        );
        $response = NeptuneHelpers::httpPost("addNode", $data);
    }

    private function addLinkInNeptune($link)
    {
        $data = array(
            'from' => "node-" . $link->source,
            'to' => "node-" . $link->target
        );
        $response = NeptuneHelpers::httpPost("addEdge", $data);
    }

    private function reverseLinkInNeptune($link)
    {
        $data = array(
            'from' => "node-" . $link->source,
            'to' => "node-" . $link->target
        );
        $response = NeptuneHelpers::httpPost("reverseEdge", $data);
    }

    // DELETE Requests

    private function deleteLinkInNeptune($link)
    {
        $response = NeptuneHelpers::httpDelete("deleteEdge?from=node-" . $link->source . "&to=node-" . $link->target);
    }

    private function deleteNodeInNeptune($nodeId)
    {
        $response = NeptuneHelpers::httpDelete("deleteVertex?id=node-" . strval($nodeId));
    }

    private function deleteTapestryInNeptune()
    {
        $response = NeptuneHelpers::httpDelete("deleteVertex?id=" . strval($this->postId));
    }

    // GET Requests

    private function getTapestryFromNeptune()
    {
        $response = NeptuneHelpers::httpGet("getTapestryNodes?id=" . strval($this->postId) . "&userId=" . strval(get_current_user_id())
        . "&roles=" . NeptuneHelpers::getRolesAsString(get_current_user_id()));
        $tapestry = json_decode($response);
        $tapestry->rootId = intval($tapestry->rootId);
        NeptuneHelpers::convertLinkAttributesToInt($tapestry->links);
        // Converting $tapestry->nodes from an object to an array with formatted nodeObjects
        $tapestry->nodes = NeptuneHelpers::convertObjectsToArr($tapestry->nodes, $this->postId);
        return $tapestry;
    }
}
