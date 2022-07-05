# tapestry-wp-graphDB

This is a plugin for Wordpress that allows creating non-linear, collaborative, and interactive content. This plugin adds a new post type to Wordpress called "Tapestry" and allows presentation and authoring in the frontend using Vue JS. This repository is a fork of the [original plugin repository](https://github.com/UBC-CIC/Tapestry) and uses a graph database.

Visit [tapestry-tool.com](https://www.tapestry-tool.com) for more info.

## Development

The Vue application is loaded in the tapestry post type template under `templates/single-tapestry.php`. It is located in the `templates/vue` directory.

### Local Development

To get started with developing locally:
- Clone this repo into a directory called `tapestry` under your Wordpress directory in the plugins folder (`wp-content/plugins`)
- Setup your local dev environment. You have 2 options for your local development:
  1. *Using LAMP/MAMP/WAMP:* Follow the detailed instruction for [Mac, Windows](https://github.com/wynnset/tapestry-wp/wiki/Getting-Started-(Mac-&-Windows)), or [Linux](https://github.com/wynnset/tapestry-wp/wiki/Getting-Started-on-Arch-Linux).
  2. *Using Docker:* Follow the detailed [Docker Installation & Usage](https://github.com/wynnset/tapestry-wp/wiki/Docker-Installation-&-Usage) wiki page.
- Follow the steps below under "Getting external links to work"
- Make sure `$TAPESTRY_USE_DEV_MODE` is set to `TRUE` in `tapestry.php`
- In the `templates/vue` directory, run `npm start` to serve with hot reload at localhost:8080

**Note:** If `npm install` does not work, try `npm install --legacy-peer-deps`

### Build & Deployment

To build a new plugin zip file with your local edits:
- CD into the `templates/vue` directory and run: `npm install && npm run build`
- Open up `tapestry.php` and set `$TAPESTRY_USE_DEV_MODE` to `FALSE`
- You can safely delete:
  - All hidden files in the root directory
  - All files and directories in the `templates/vue` directory except the `dist` folder
- Zip the `tapestry` folder and upload it in your other Wordpress instance under Plugins > Add New > Upload Plugin

**Note:** If `npm install` does not work, try `npm install --legacy-peer-deps`

### Cloud Resources

This version of Tapestry is enhanced by use of a graph database (Amazon Neptune). So, before beginnig to use this plugin, make sure you provision all cloud resources and configure the plugin to work with them. For instructions on how to do that and details about the cloud infrastructure used by this plugin, visit this [repository](https://github.com/UBC-CIC/Tapestry).

### Getting external links to work

It's strongly recommended you complete this to get link previews working for the "External Link" content type. To do this, you will need to get an API key for LinkPreview and set a config variable first by following these instructions:

1. Navigate to [linkpreview.net](https://www.linkpreview.net/) and sign up to get an API Key
2. Once logged in, press "Generate new access key" on the top right corner and copy the key
3. In the `templates/vue` directory, create a `.env` file containing the following line:
    ```
    LINK_PREVIEW_API_KEY=<key>
    ```
    where `<key>` is the key you generated.

If you complete these steps before running `npm run build`, you will have link previews working.

### Development Tasks Remaining

1. **Loading additional data**: To be fully functional, certain node properties must still be loaded from the relational database in an efficient manner. SInce these properties are required only to view node contents, one efficient way of handling them would be to load them right when a user clicks on a node to view its contents. These properties include:
   ```bash
   typeData
   reviewComments
   license
   references
   ```
2. **Handle duplication of data in databases**: Currently, all data in the various WordPress tables is still stored in those tables with the same meta_key. For more information about this, refer to this [link](https://github.com/UBC-CIC/Tapestry#relational-database). Ideally, only those properties that are not being stored on the graph database should be stored on the relational database.
