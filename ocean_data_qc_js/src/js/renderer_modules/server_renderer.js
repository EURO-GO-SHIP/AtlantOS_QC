// //////////////////////////////////////////////////////////////////////
//  License, authors, contributors and copyright information at:       //
//  AUTHORS and LICENSE files at the root folder of this application   //
// //////////////////////////////////////////////////////////////////////

"use strict";

const path = require('path');
const app_module_path = require('app-module-path')
app_module_path.addPath(path.join(__dirname, '../modules'));
app_module_path.addPath(path.join(__dirname, '../modals_renderer'));
app_module_path.addPath(__dirname);

const { ipcRenderer } = require('electron');
const command_exists_sync = require('command-exists').sync;
const rmdir = require('rimraf');
const url_exist = require('url-exist');
const fs = require('fs');
const { spawn } = require('child_process');
const python_shell = require('python-shell');

const lg = require('logging');
const loc = require('locations');
const tools = require('tools');
const data = require('data');


module.exports = {
    init: function() {
        var self = this;
        self.ipc_renderer = ipcRenderer;
        self.set_python_path();
        self.check_previous_session();
    },

    uncaught_exception_dialog: function(error) {
        tools.show_modal({
            type: 'UNCAUGHT EXCEPTION',
            code: error
        });
    },

    bokeh_error_loading: function() {
        var self = this;
        tools.modal_question({
            title: 'Restart app?',
            msg: 'Bokeh Server could not be loaded. Other instance of the app may be open or not correctly closed. ' +
                   'Close it correctly before opening another one. Do you want to restart this instance of the app ' +
                   'to try it again? If you press "No" this instance will close',
            callback_yes: function() {
                ipcRenderer.send('restart-app');
            },
            callback_no: function() {
                ipcRenderer.send('exit-app');   // close without throwing any event
            },
            callback_close: function() {
                ipcRenderer.send('exit-app');
            }
        })

        $('#modal_question .close').on('click', function() {
            no_callback();
        });
    },

    go_to_bokeh: function() {
        lg.info('-- GO TO BOKEH');
        var self = this;
        $('body').css('overflow-y', 'hidden');  // to prevent two scrolls on the right
        tools.show_loader();
        var _checkBokehSate = setInterval(function() {
            lg.info('>> BOKEH STATE: ' + $('body').data('bokeh_state')
                    + ' | OCTAVE STATE: ' + $('body').data('oct_state'));
            if ($('body').data('bokeh_state') == 'ready' && $('body').data('ts_state') != 'checking'
               && $('body').data('oct_state') == 'checked') {

                clearInterval(_checkBokehSate);
                if ($('body').data('ts_state') == 'offline') {
                    ipcRenderer.send('run-tile-server');
                }
                self.init_bokeh()
            }
        }, 100);
    },

    init_bokeh: function() {
        var self = this;
        var call_params = {
            'object': 'bokeh.loader',
            'method': 'init_bokeh',
            'args': {
                'ts_state': $('body').data('ts_state'),
            }
        }
        tools.call_promise(call_params).then((result) => {
            self.run_on_ready();
        });
    },

    go_to_welcome: function() {
        // the loader is not needed here, very fast transition
        $('#bokeh_iframe').fadeOut('slow', function(){
            $('body').css('overflow-y', 'auto')
            $('.welcome_container').fadeIn('slow');
        });
    },

    reset_bokeh: function() {
        var self = this;
        var call_params = {
            'object': 'bokeh.loader',
            'method': 'reset_bokeh',
        }
        tools.call_promise(call_params).then((result) => {
            lg.info('-- RESETING BOKEH');
            self.go_to_welcome();
            ipcRenderer.send('set-main-menu');
        });
    },

    reset_bokeh_cruise_data: function() {
        var self = this;
        var call_params = {
            'object': 'bokeh.loader',
            'method': 'reset_env_cruise_data',
        }
        tools.call_promise(call_params).then((result) => {
            lg.info('-- RESETING BOKEH AND CRUISE DATA');
            self.go_to_welcome();
            ipcRenderer.send('set-main-menu');
        });
    },

    reload_bokeh: function(callback=null) {
        var self = this;
        tools.show_loader();
        var call_params = {
            'object': 'bokeh.loader',
            'method': 'reload_bokeh',
        }
        tools.call_promise(call_params).then((result) => {
            lg.info('-- RELOADING BOKEH');
            self.run_on_ready();
            tools.hide_loader();
            if (callback != null) {
                callback();
            }
        });
    },

    run_on_ready: function() {
        var self = this;
        lg.info('-- RUN ON READY');
        document.getElementById('bokeh_iframe').contentWindow.postMessage({
            'signal': 'on-ready',
            'message_data': 'continue'
        } , '*');  // to index.html

        // This waits for the back signal 'on-ready' in the main_renderer.js file
    },

    run_on_ready_final_step: function() {
        lg.info('-- ON-READY SIGNAL, FINAL STEP');
        var self = this;
        // TODO: check if it is an aqc (mark watcher as saved file) or a csv file (mark as modified)

        var project_file = data.get('project_file', loc.proj_settings);
        var project_state = 'modified';
        if (project_file !== false) {
            data.set({'project_state': 'saved'}, loc.shared_data);  // although it should be saved already
            project_state = 'saved';
        } else {
            data.set({'project_state': 'modified'}, loc.shared_data);
            project_state = 'modified';
        }
        ipcRenderer.send('enable-watcher', {
            'mark': project_state,
            'set_bokeh_menu': true
        });
        tools.show_default_cursor();
        tools.hide_loader();
    },

    come_back_to_welcome: function(reset_cruise_data=false) {
        lg.info('-- COME BACK TO WELCOME --');
        var self = this;
        document.title = 'AtlantOS Ocean Data QC!';
        ipcRenderer.send('disable-watcher');
        rmdir(loc.proj_files, function (err) {
            if (err) {
                tools.showModal(
                    'ERROR',
                    'Something was wrong deleting temporal files:<br />' + err
                );
                return;
            }
            lg.info('Project files deleted');
            if (reset_cruise_data) {
                self.reset_bokeh_cruise_data();
            } else {
                self.reset_bokeh();
            }
        });
    },

    /* Checks if the command Octave exists in the PATH environment variable
    *  If it does not exist, then Octave cannot be used
    *       @manual_octave_folder_path !== false: The path is being set manually
    */
    set_octave_path: function(manual_octave_folder_path=false) {
        lg.info('-- SET OCTAVE PATH METHOD');
        var self = this;
        if (manual_octave_folder_path !== false) {  // manual_octave_folder_path is always going to exist
                                                   // but the octave-cli.exe may not exist in that folder
            self.octave_path = manual_octave_folder_path;
            self.set_octave_exe_path();
        } else {
            self.octave_path = data.get('octave_path', loc.shared_data);
            if (self.octave_path === false || (self.octave_path !== false && !fs.existsSync(tools.file_to_path(self.octave_path)))) {
                self.guess_octave_exe_path();
            } else {  // path is already set
                self.set_octave_exe_path();
            }
        }
    },

    set_octave_version: function() {
        lg.info('-- SET OCTAVE VERSION')
        var self = this;
        self.octave_version = false;

        if (self.octave_path === false) {
            self.set_octave_info('Undetected');
            data.set({'octave_version': false}, loc.shared_data);
            data.set({'octave_path': false}, loc.shared_data);
            $('body').data('oct_state', 'checked');
            return;
        }

        var op = tools.file_to_path(self.octave_path)
        var full_str_version = '';
        const octave = spawn(
            path.basename(op),                        // TODO: command >> is this working on mac an linux?
            ['--eval', '"OCTAVE_VERSION"'],     // args
            {                                   // options
                'shell': true,
                'cwd': path.dirname(op)
            }
        );
        octave.stdout.on('data', (buffer) => {
            var version = buffer.toString('utf8');
            full_str_version += version;
            if (full_str_version.match(/ans = [0-9]\.[0-9]\.[0-9]/g) != null) {
                // NOTE: When the expression is full (all buffers concatenated)
                //       Expected answer: "ans = 4.1.4"
                self.octave_version = full_str_version.split('=')[1].trim();
                data.set({'octave_version': self.octave_version}, loc.shared_data);
                self.set_octave_info();
                $('body').data('oct_state', 'checked');
            }
        });
        octave.stderr.on('data', (data) => {
            self.set_octave_info(`Error detecting Octave version: ${data}`);
            data.set({'octave_version': false}, loc.shared_data);
            data.set({'octave_path': false}, loc.shared_data);
            $('body').data('oct_state', 'checked');
        });
    },

    set_octave_info: function(msg=false) {
        lg.info('-- SET OCTAVE INFO')
        var self = this;
        if (self.octave_version !== false) {
            $('#octave_version').text(self.octave_version);
            $('#octave_version').css('color', 'black');
            $('#octave_version').css('font-weight', 'normal');
            $('#set_octave_path_manually').css('display', 'none');
        } else {
            lg.warn('>> OCTAVE UNDETECTED');
            if (msg !== false) {
                $('#octave_version').text(msg + '. ');
            } else {
                $('#octave_version').text('Undetected. ');
            }
            $('#octave_version').css('color', 'red');
            $('#octave_version').css('font-weight', 'bold');

            $('#set_octave_path_manually').css('display', 'inline');
        }
    },

    guess_octave_exe_path: function() {
        lg.info('-- GUESS OCTAVE EXE PATH')
        var self = this;
        var params = {
            'object': 'octave.equations',
            'method': 'guess_oct_exe_path'
        }
        tools.call_promise(params).then((results) => {
            if (typeof(results) === 'undefined') {
                lg.warn('>> Octave undetected in PATH');
                data.set({'octave_path': false, 'octave_version': false, }, loc.shared_data);
                self.set_octave_info('Undetected');
                $('body').data('oct_state', 'checked');
            } else {
                self.octave_path = results['octave_path'];
                data.set({'octave_path': self.octave_path }, loc.shared_data);
                self.set_octave_version();
            }
        })
    },

    set_octave_exe_path: function() {
        lg.info('-- SET OCTAVE EXE PATH');
        var self = this;
        var params = {
            'object': 'octave.equations',
            'method': 'set_oct_exe_path',
            'args': self.octave_path,
        }
        tools.call_promise(params).then((results) => {
            if (typeof(results) === 'undefined' || results == null) {
                lg.warn('>>Error detecting Octave executable');
                data.set({'octave_path': false, 'octave_version': false, }, loc.shared_data);
                self.set_octave_info('Undetected in PATH');
                $('body').data('oct_state', 'checked');
            } else {
                if (results['octave_path'] === false) {
                    tools.show_modal({
                        'type': 'ERROR',
                        'msg_type': 'html',
                        'msg': 'Octave was not found in the selected folder with the names:' +
                               ' <span class="code_msg">octave-cli.exe</span> or <span class="code_msg">octave-cli</span>. ' +
                               'Therefore, the library <span class="code_msg">oct2py</span> could not be imported. ' +
                               'Please, select the correct folder.'
                    });
                    return;
                }
                self.octave_path = results['octave_path'];
                data.set({'octave_path': self.octave_path }, loc.shared_data);
                self.set_octave_version();
            }
        });
    },

    check_python_version: function() {
        // TODO: repeated method, move to tools.js or somewhere else

        var self = this;
        return new Promise((resolve, reject) => {
            var py_options = {
                mode: 'text',
                pythonPath: self.python_path,
                scriptPath: loc.scripts
            };
            python_shell.run('get_python_version.py', py_options, function (err, results) {
                if (err) {
                    reject('>> Error running script: ' + err);
                } else {
                    if (typeof(results) !== 'undefined') {
                        try {
                            var v = parseInt(results[0].split('.')[0])
                        } catch(err) {
                            reject('Version could not be parsed');
                        }
                        if (v == 3) {
                            resolve(true)
                        } else {
                            reject('Wrong python version: ' + results[0]);
                        }
                    }
                }
            });
        });
    },

    /** Sets the python path
     *    1. First check if python exists in the environment
     *    2. If not it will use the local python instaled in the system
     *  Sets scripts python path as well
    */
    set_python_path: function() {
        // TODO: repeated method, move to tools.js or somewhere else

        lg.info('-- SET PYTHON PATH (server_renderer.js)')
        var self = this;
        if (process.platform === 'win32' && fs.existsSync(loc.python_win)) {
            self.python_path = loc.python_win;
            self.script_env_path = loc.env_bin_win;
        } else if (process.platform === 'darwin' && fs.existsSync(loc.python_mac)) {
            self.python_path = loc.python_mac;
            self.script_env_path = loc.env_bin_mac;
        } else if (process.platform === 'linux' && fs.existsSync(loc.python_lin)) {
            self.python_path = loc.python_lin;
            self.script_env_path = loc.env_bin_lin;
        } else {
            self.python_path = 'python';
        }
        lg.info('>> (SET_PYTHON_PATH) SELF.PYTHON_PATH: ' + self.python_path)
        self.check_python_version().then(() => {
            self.get_css_checksums();
        }).catch((err) => {
            lg.warn('>> WRONG PYTHON PATH: ' + self.python_path);
            lg.warn('>> ERR: ' + err);
            if (command_exists_sync('python')) {
                self.python_path = 'python'
                self.check_python_version().then(() => {
                    self.get_css_checksums();
                }).catch((err) => {
                    lg.warn('>> WRONG PYTHON PATH USED: ' + self.python_path);
                    lg.warn('>> ERR: ' + err);
                })
            } else {
                if (command_exists_sync('python3')) {
                    self.python_path = 'python3'
                    self.check_python_version().then(() => {
                        self.get_css_checksums();
                    }).catch((err) => {
                        lg.warn('>> WRONG PYTHON PATH USED: ' + self.python_path);
                        lg.warn('>> ERR: ' + err);
                    })
                }
            }
        })
    },

    /* This method is used to add a hash file as a parameter in the links to css files.
    *  The files will be loaded from cache only if there are no new changes.
    *
    *  There is a simpler solution using the timestamp, but in this case the files
    *  would be always reloaded: https://stackoverflow.com/a/8331646/4891717
    */
    get_css_checksums: function() {
        lg.info('-- GET CSS CHECKSUMS');
        var self = this;
        var py_options = {
            mode: 'text',
            pythonPath: self.python_path,
            scriptPath: loc.scripts,
        };
        self.shell = python_shell.run('get_css_checksums.py', py_options, function (err, results) {
            if (err || typeof(results) == 'undefined') {  // The script get_module_path.py did not return the correct path
                lg.error('Error running get_css_checksums.py: ' + err);
            } else {
                results = results[0]
                results = results.replace(/'/g,'"');
                results = results.replace('\r','');
                results = JSON.parse(results);  // try catch ??
                // lg.warn('>> RESULTS: ' + JSON.stringify(results, null, 4));
                $.each(results, function(key, value) {
                    if (key == 'electron_css_path') {  // TODO: How to run this before the window is shown?
                        $.each(results[key], function(file_name, hash) {
                            var css = $("link[href$='" + file_name + "']");
                            css.attr('href', css.attr('href') + '?v=' + hash);
                        });
                        $('.welcome_container').fadeIn(500);
                    }
                });
            }
        });
    },

    check_tile_server_state: function() {
        lg.info('-- CHECK TILE SERVER STATE')
        // check ArcGIS Tile Server State
        url_exist('https://server.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/0/0/0').then((exists) => {
            if (exists) {
                lg.info('Tile server online');
                $('body').data('ts_state', 'online');

                $('#argis_tile_server_state').text('Online');
                $('#argis_tile_server_state').css('color', 'green');
            } else {
                lg.warn('Tile server offline, or there is no internet connection');
                $('body').data('ts_state', 'offline');

                $('#argis_tile_server_state').text('Offline');
                $('#argis_tile_server_state').css('color', 'red');
            }
            $('#argis_tile_server_state').css('font-weight', 'bold');
        });
    },

    json_template_restore_to_default: function() {
        var self = this;
        tools.modal_question({
            'title': 'Overwrite Settings?',
            'msg': 'Are you sure that you want to overwrite the Settings File with the default values?' +
                    ' The changes that you may have done will be lost.',
            'callback_yes': self.json_template_send_restore_to_default_signal,
            'self': self
        })
    },

    json_template_send_restore_to_default_signal: function(self=false) {
        lg.warn('JSON TEMPLATE SEND RESTORE TO DEFAULT SIGNAL');
        if (self === false) {
            var self = this;
        }
        self.ipc_renderer.send('json-template-restore-to-default');
    },

    /* If the folder "files" exists then the application was closed by force
        ask to the user if try to open the last file, or discard the open file
    */
    check_previous_session: function() {
        var self = this;
        var file_to_open = data.get('file_to_open', loc.shared_data);
        lg.info('>> FILE TO OPEN: ' + file_to_open);
        if (file_to_open != '--updated') {  // if the app is not being updated

            // wait for app detection bokeh >> ready is the only way, but it will take time
            // before bokeh is launched port detection should take place

            if (fs.existsSync(loc.proj_files)) {
                lg.info('-- PENDING PREVIOUS SESSION');
                var proj_name = data.get('project_name', loc.proj_settings);
                if (proj_name == 'default_settings') {  // if the user did not accept al plot the las time
                                                        // and the app was interrupted
                    self.rmv_proj_files();
                } else {
                    self.restore_session(file_to_open);
                }
            } else {
                // check if there is file to open
                if (file_to_open !== false) {
                    data.set({'file_to_open': false}, loc.shared_data);
                    self.ipc_renderer.send('open-file', [file_to_open]);
                }
            }
        }
    },

    rmv_proj_files: function(file_to_open=false) {
        var self = this;
        data.set({'file_to_open': false}, loc.shared_data);
        rmdir(loc.proj_files, function () {
            // TODO: if an error occur, then the window is shown again, or an error appears
            lg.info('Directory files removed');
            if (file_to_open !== false) {
                self.ipc_renderer.send('open-file', [file_to_open]);
            }
        });
    },

    restore_session: function(file_to_open=false) {
        var self = this;
        var msg = '<p>A previous session was not closed correctly. ' +
                  'Would you like to reopen it? ' +
                  'If you press "No", or you close this dialog the changes will be lost.</p>'

        if (file_to_open !== false) {
            msg += '<p>Also, the file you are actually opening is going to be processed instead: </p>' +
                   '<pre>' + file_to_open + '</pre>';
        }

        var cb_no = function() {
            var file_to_open = data.get('file_to_open', loc.shared_data);
            self.rmv_proj_files(file_to_open);
        }

        tools.modal_question({
            title: 'Restore previous open session?',
            msg: msg,
            callback_yes: function() {
                data.set({'file_to_open': false}, loc.shared_data);
                self.go_to_bokeh();
            },
            callback_no: cb_no,
            callback_close: cb_no,
            self: self
        })
    },

    /** Loads images, I need to do this because when they are in the .asar file
     *  they are not read well
     */
    load_images: function() {
        fs.readFile(path.join(loc.img, 'icon.png'), {encoding: 'base64'}, function(err, data) {
            if (err) {
                lg.error('ERROR LOADING ICON.PNG: ' + err)
            } else {
                var img = $('<img>', {
                    id: 'ctd_logo',
                    src: 'data:image/png;base64,' + data,
                    style: 'display: none;',
                });
                $('#logos_div').append(img);

                fs.readFile(path.join(loc.img, 'atlantos_logo.svg'), {encoding: 'base64'}, function(err, data) {
                    if (err) {
                        lg.error('ERROR LOADING ATLANTOS_LOGO.SVG: ' + err)
                    } else {
                        var img = $('<img>', {
                            id: 'atlantos_logo',
                            src: 'data:image/svg+xml;base64,' + data,
                            style: 'display: none;',
                        });
                        $('#logos_div').append(img);
                        $('#logos_div img').fadeIn(1000);
                    }
                });
            }
        });
    }
}