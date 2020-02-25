# **PySearch**

## A faster way to code

**PySearch** provides intelligent completion suggestions that improve on ordinary Google search, by incorporating the context surrounding each query and learning on the fly.


## Getting Started:

0. (Optional) Add your python runtime to the PySearch config.

  `View -> Command Palate -> Preferences: Open User Settings -> Extensions -> PySearch`

<img src="https://raw.githubusercontent.com/flowbot-inc/pysearch-vscode/master/docs/images/add_env.png" alt="getstarted0">

1. Create or open a folder in your workspace:

  `File -> Add Folder to Workspace...`

2. Create or open a Python file in the folder:

  `File -> New File`

  `File -> Save As... -> new_folder/filename.py`

<img src="https://raw.githubusercontent.com/flowbot-inc/pysearch-vscode/master/docs/images/new_file.png" alt="getstarted2">

3. Follow prompt to download [pyls](https://github.com/palantir/python-language-server):

  Or..

  Run `pip install python-language-server` in the command-line

  `View -> Command Palate -> Developer: Reload Window`

<img src="https://raw.githubusercontent.com/flowbot-inc/pysearch-vscode/master/docs/images/open_file.png" alt="getstarted3">

4. Install non-standard libraries in your python runtime to begin making PySearch queries

  e.g. `pip install sklearn`

## Using PySearch:

To make a PySearch query, type the delimiter (`!!` *by default, but user-configurable*) to begin a search:


<img src="https://raw.githubusercontent.com/flowbot-inc/pysearch-vscode/master/docs/images/cosine_distance.png" alt="cd3">


For more control over query results, try adding the `--context` flag (alias `-c`) anywhere in your query
to scale context sensitivity.

The `--context` flag takes integer values from `0` through `5`, where higher numbers increase context sensitivity.

<img src="https://raw.githubusercontent.com/flowbot-inc/pysearch-vscode/master/docs/images/cosine_distance_c0.png" alt="cd0">

While PySearch searches only functions across Python 3.7+, broader coverage is currently in alpha. Our search indexes are hosted in PySearch Cloud, and we're actively working on rolling out a local version. All requests are TLS/SSL encrypted, anonymized, and **never** sold or shared.

## Troubleshooting

1. If PySearch queries aren't working, check the logs to confirm the server started successfully:

  `View -> Output`

  Check the `Output` tab under `PySearch` for `PySearch server is starting up`

<img src="https://raw.githubusercontent.com/flowbot-inc/pysearch-vscode/master/docs/images/server_log.png" alt="troubleshooting1">

2. VScode uses events to trigger the server startup process, so try reloading the window if you aren't getting PySearch results (as the server may never have been triggered, or pyls may have died)

  `View -> Command Palate -> Developer: Reload Window`

3. If the server startup isn't initiated upon reloading, you may not have opened your Python file in an active workspace (see "Getting Started" step #1)

4. If your PySearch results aren't including non standard library packages, check that the package is installed in your python runtime in "Getting Started" step #4.

5. For feedback or additional support, visit us [here](https://www.getflowbot.com).

## Known Issues


## Release Notes


### 0.2.3

Initial release

___

Made with ❤ by Flowbot Inc
