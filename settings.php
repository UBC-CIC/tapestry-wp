<?php

add_action('init', 'run_db_commands');
add_action('admin_init', 'tapestry_settings_init');
add_action('admin_menu', 'add_tapestry_settings_page');

function add_tapestry_settings_page()
{
    add_options_page('tapestry_plugin_settings', 'Tapestry', 'administrator', 'tapestry_settings_page', 'tapestry_settings_page_cb');
}

function tapestry_settings_init()
{
    add_settings_section('tapestry_db_settings', 'Database Settings', 'tapestry_db_section_cb', 'tapestry_settings_page');
    add_settings_field('tapestry_clean_h5p_nodes', 'Clean h5p Nodes', 'tapestry_clean_h5p_nodes_cb', 'tapestry_settings_page', 'tapestry_db_settings');
    add_settings_section('neptune_db_settings', 'Neptune Settings', 'neptune_section_cb', 'neptune_settings_page');
    add_settings_field('neptune_api_field', 'Neptune API endpoint', 'neptune_field_cb', 'neptune_settings_page', 'neptune_db_settings');
    add_settings_field('neptune_key_field', 'Neptune API Security Key', 'neptune_key_field_cb', 'neptune_settings_page', 'neptune_db_settings');
}

function tapestry_settings_page_cb()
{
    ?>
    <h2>Tapestry Plugin Settings</h2>
    <form action="<?php htmlspecialchars($_SERVER["PHP_SELF"]); ?>" method="post">
            <?php
            do_settings_sections('tapestry_settings_page'); ?>
        <input type="submit" value="Run" name="tapestry_db"/>
    </form>
    <form action="<?php htmlspecialchars($_SERVER["PHP_SELF"]); ?>" method="post">
            <?php
            do_settings_sections('neptune_settings_page'); ?>
        <input type="submit" value="Submit" name="neptune_api_endpoint"/>
    </form>
    <?php
}

function tapestry_db_section_cb()
{
    echo 'Perform database modifications';
}


function tapestry_clean_h5p_nodes_cb()
{
    echo "<input type='checkbox' id='clean_h5p_nodes' name='clean_h5p_nodes'  value='1'/>";
}

function neptune_section_cb()
{
    echo 'Change API Endpoint';
}

function neptune_field_cb()
{
    echo "<input type='text' id='api_endpoint' name='api_endpoint' />";
}

function neptune_key_field_cb()
{
    echo "<input type='text' id='security_key' name='security_key' />";
}

function run_db_commands()
{
    if (isset($_POST['tapestry_db'])) {
        if (isset($_POST['clean_h5p_nodes'])) {
            $query_args = array(
                'post_type' => 'tapestry_node',
                'meta_query' => array(
                    array(
                       'key'     => 'tapestry_node_data',
                       'value'   => 'h5p',
                       'compare' => 'LIKE',
                    ),
                    array(
                        'key'     => 'tapestry_node_data',
                        'value'   => 'video',
                        'compare' => 'LIKE',
                    ),
                ),
            );
            $h5p_query = new WP_Query($query_args);
            while ($h5p_query->have_posts()) {
                $h5p_query->the_post();
                $post_id = get_the_ID();
                $node_meta_data = get_post_meta($post_id, 'tapestry_node_data', true);
                if (isset($node_meta_data->mediaFormat) && $node_meta_data->mediaFormat == 'h5p' && isset($node_meta_data->mediaType) && $node_meta_data->mediaType == 'video') {
                    $node_meta_data->mediaType = 'h5p';
                    update_post_meta($post_id, 'tapestry_node_data', $node_meta_data);
                }
            }
            add_action('admin_notices', 'tapestry_h5p_conf_notice');
        }
    }
    // Executed if the "Submit" button is clicked
    if (isset($_POST['neptune_api_endpoint'])) {
        // Executed if API Endpoint specified
        if (isset($_POST['api_endpoint']) && $_POST['api_endpoint'] != '') {
            if (get_option('api_endpoint') === false) {
                add_option('api_endpoint', $_POST['api_endpoint']);
            } else {
                update_option('api_endpoint', $_POST['api_endpoint']);
            }
            wp_logout();  // Logs the user out to keep track of users on Neptune
        }
        // Executed if Security Key specified
        if (isset($_POST['security_key']) && $_POST['security_key'] != '') {
            if (get_option('security_key') === false) {
                add_option('security_key', $_POST['security_key']);
            } else {
                update_option('security_key', $_POST['security_key']);
            }
            wp_logout();  // Logs the user out to keep track of users on Neptune
        }
    }
}

function tapestry_h5p_conf_notice()
{
    ?>
      <div class="notice updated" >
      <p><?php _e('Clean h5p Nodes ran successfully'); ?></p>
    </div>
    <?php
}
