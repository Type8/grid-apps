
/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

"use strict";

(function() {

    if (self.kiri.init) return;

    const KIRI = self.kiri,
        BASE = self.base,
        MOTO = self.moto,
        CONF = KIRI.conf,
        WIN = self.window,
        DOC = self.document,
        LOC = self.location,
        API = KIRI.api,
        SDB = API.sdb,
        UI = API.ui,
        UC = API.uc,
        SEED = API.const.SEED,
        LANG = API.const.LANG,
        VIEWS = API.const.VIEWS,
        MODES = API.const.MODES,
        LOCAL = API.const.LOCAL,
        SETUP = API.const.SETUP,
        DEFMODE = SETUP.dm && SETUP.dm.length === 1 ? SETUP.dm[0] : 'FDM',
        STARTMODE = SETUP.sm && SETUP.sm.length === 1 ? SETUP.sm[0] : null,
        SPACE = KIRI.space,
        STATS = API.stats,
        DEG = Math.PI/180,
        ALL = [MODES.FDM, MODES.LASER, MODES.CAM, MODES.SLA],
        CAM = [MODES.CAM],
        SLA = [MODES.SLA],
        FDM = [MODES.FDM],
        FDM_SLA = [MODES.FDM,MODES.SLA],
        FDM_CAM = [MODES.CAM,MODES.FDM],
        FDM_LASER = [MODES.LASER,MODES.FDM],
        FDM_LASER_SLA = [MODES.LASER,MODES.FDM,MODES.SLA],
        CAM_LASER = [MODES.LASER,MODES.CAM],
        GCODE = [MODES.FDM, MODES.LASER, MODES.CAM],
        LASER = [MODES.LASER],
        CATALOG = API.catalog,
        js2o = API.js2o,
        o2js = API.o2js,
        platform = API.platform,
        selection = API.selection;

    let currentDevice = null,
        deviceURL = null,
        deviceTexture = null,
        deviceImage = null,
        deviceLock = false,
        selectedTool = null,
        editTools = null,
        maxTool = 0,
        fpsTimer = null,
        platformColor;

    // extend KIRI API with local functions
    API.show.devices = showDevices;
    API.device.set = selectDevice;
    API.device.clone = cloneDevice;

    function settings() {
        return API.conf.get();
    }

    function checkSeed(then) {
        // skip sample object load in onshape (or any script postload)
        if (!SDB[SEED]) {
            SDB[SEED] = new Date().getTime();
            if (!SETUP.s && API.feature.seed) {
                platform.load_stl("/obj/cube.stl", function(vert) {
                    CATALOG.putFile("sample cube.stl", vert);
                    platform.compute_max_z();
                    SPACE.view.home();
                    setTimeout(() => { API.space.save(true) },500);
                    then();
                    API.help.show();
                });
                return true;
            }
        }
        return false;
    }

    function unitsSave() {
        API.conf.update({controller:true});
        platform.update_size();
    }

    function aniMeshSave() {
        API.conf.update({controller:true});
        API.conf.save();
    }

    function lineTypeSave() {
        const sel = UI.lineType.options[UI.lineType.selectedIndex];
        if (sel) {
            settings().controller.lineType = sel.value;
            API.conf.save();
        }
    }

    function detailSave() {
        let level = UI.detail.options[UI.detail.selectedIndex];
        if (level) {
            level = level.value;
            let rez = BASE.config.clipperClean;
            switch (level) {
                case 'best': rez = 50; break;
                case 'good': rez = BASE.config.clipperClean; break;
                case 'fair': rez = 500; break;
                case 'poor': rez = 1000; break;
            }
            KIRI.client.config({
                base: { clipperClean: rez }
            });
            settings().controller.detail = level;
            API.conf.save();
        }
    }

    function speedSave() {
        settings().controller.showSpeeds = UI.showSpeeds.checked;
        API.platform.update_speeds();
    }

    function booleanSave() {
        let control = settings().controller;
        let isDark = control.dark;
        control.expert = UI.expert.checked;
        control.decals = UI.decals.checked;
        // control.hoverPop = UI.hoverPop.checked;
        control.showOrigin = UI.showOrigin.checked;
        control.showRulers = UI.showRulers.checked;
        control.autoLayout = UI.autoLayout.checked;
        control.freeLayout = UI.freeLayout.checked;
        control.alignTop = UI.alignTop.checked;
        control.autoSave = UI.autoSave.checked;
        control.reverseZoom = UI.reverseZoom.checked;
        control.dark = UI.dark.checked;
        control.exportOcto = UI.exportOcto.checked;
        control.exportGhost = UI.exportGhost.checked;
        control.exportLocal = UI.exportLocal.checked;
        control.exportPreview = UI.exportPreview.checked;
        control.decimate = UI.decimate.checked;
        SPACE.view.setZoom(control.reverseZoom, control.zoomSpeed);
        platform.layout();
        API.conf.save();
        API.mode.set_expert(control.expert);
        API.platform.update_size();
        API.catalog.setOptions({
            maxpass: control.decimate ? 10 : 0
        });
        UC.setHoverPop(false);
        updateFPS();
        if (control.decals) {
            loadDeviceTexture(currentDevice, deviceTexture);
        } else {
            clearDeviceTexture();
        }
        API.event.emit('boolean.update');
    }

    function updateFPS() {
        clearTimeout(fpsTimer);
        const on = UI.expert.checked;
        UI.fps.style.display = on ? 'block' : '';
        if (on) {
            setInterval(() => {
                const nv = SPACE.view.getFPS().toFixed(2);
                if (nv !== UI.fps.innerText) {
                    UI.fps.innerText = nv;
                }
            }, 100);
        }
    }

    function onLayerToggle() {
        API.conf.update();
        API.show.slices();
    }

    function onBooleanClick() {
        // prevent hiding elements in device editor on clicks
        if (!API.modal.visible()) {
            UC.refresh();
        }
        API.conf.update();
        DOC.activeElement.blur();
        // API.event.emit("boolean.click");
    }

    function onButtonClick(ev) {
        let target = ev.target;
        while (target && target.tagName !== 'BUTTON') {
            target = target.parentNode;
        }
        API.event.emit("button.click", target);
    }

    function inputHasFocus() {
        let active = DOC.activeElement;
        return active && (active.nodeName === "INPUT" || active.nodeName === "TEXTAREA");
    }

    function inputTextOK() {
        return DOC.activeElement === UI.deviceName;
    }

    function textAreaHasFocus() {
        let active = DOC.activeElement;
        return active && active.nodeName === "TEXTAREA";
    }

    function inputSize() {
        return parseInt(DOC.activeElement.size);
    }

    function cca(c) {
        return c.charCodeAt(0);
    }

    function keyUpHandler(evt) {
        if (API.feature.on_key) {
            if (API.feature.on_key({up:evt})) return;
        }
        switch (evt.keyCode) {
            // escape
            case 27:
                // blur text input focus
                DOC.activeElement.blur();
                // dismiss modals
                API.modal.hide();
                // deselect widgets
                platform.deselect();
                // hide all dialogs
                API.dialog.hide();
                // cancel slicing
                if (KIRI.work.isSlicing()) KIRI.work.restart();
                // kill any poppers in compact mode
                UC.hidePoppers();
                // and send an event (used by FDM client)
                API.event.emit("key.esc");
                break;
        }
        return false;
    }

    function keyDownHandler(evt) {
        if (API.modal.visible()) {
            return false;
        }
        if (API.feature.on_key) {
            if (API.feature.on_key({down:evt})) return;
        }
        let move = evt.altKey ? 5 : 0,
            deg = move ? 0 : -Math.PI / (evt.shiftKey ? 36 : 2);
        switch (evt.keyCode) {
            case 8: // apple: delete/backspace
            case 46: // others: delete
                if (inputHasFocus()) return false;
                platform.delete(API.selection.meshes());
                evt.preventDefault();
                break;
            case 37: // left arrow
                if (inputHasFocus()) return false;
                if (deg) API.selection.rotate(0, 0, -deg);
                if (move > 0) API.selection.move(-move, 0, 0);
                evt.preventDefault();
                break;
            case 39: // right arrow
                if (inputHasFocus()) return false;
                if (deg) API.selection.rotate(0, 0, deg);
                if (move > 0) API.selection.move(move, 0, 0);
                evt.preventDefault();
                break;
            case 38: // up arrow
                if (inputHasFocus()) return false;
                if (evt.metaKey) return API.show.layer(API.var.layer_at+1);
                if (deg) API.selection.rotate(deg, 0, 0);
                if (move > 0) API.selection.move(0, move, 0);
                evt.preventDefault();
                break;
            case 40: // down arrow
                if (inputHasFocus()) return false;
                if (evt.metaKey) return API.show.layer(API.var.layer_at-1);
                if (deg) API.selection.rotate(-deg, 0, 0);
                if (move > 0) API.selection.move(0, -move, 0);
                evt.preventDefault();
                break;
            case 65: // 'a' for select all
                if (evt.metaKey || evt.ctrlKey) {
                    if (inputHasFocus()) return false;
                    evt.preventDefault();
                    platform.deselect();
                    platform.select_all();
                }
                break;
            case 83: // 's' for save workspace
                if (evt.ctrlKey) {
                    evt.preventDefault();
                    API.conf.save();
                    console.log("settings saved");
                } else
                if (evt.metaKey) {
                    evt.preventDefault();
                    API.space.save();
                }
                break;
            case 76: // 'l' for restore workspace
                if (evt.metaKey) {
                    evt.preventDefault();
                    API.space.restore();
                }
                break;
        }
    }

    function keyHandler(evt) {
        let handled = true,
            current = settings(),
            style, sel, i, m, bb,
            ncc = evt.charCode - 48;
        if (API.modal.visible() || inputHasFocus()) {
            return false;
        }
        if (API.feature.on_key) {
            if (API.feature.on_key({key:evt})) return;
        }
        switch (evt.charCode) {
            case cca('`'): API.show.slices(0); break;
            case cca('0'): API.show.slices(API.var.layer_max); break;
            case cca('1'): API.show.slices(API.var.layer_max/10); break;
            case cca('2'): API.show.slices(API.var.layer_max*2/10); break;
            case cca('3'): API.show.slices(API.var.layer_max*3/10); break;
            case cca('4'): API.show.slices(API.var.layer_max*4/10); break;
            case cca('5'): API.show.slices(API.var.layer_max*5/10); break;
            case cca('6'): API.show.slices(API.var.layer_max*6/10); break;
            case cca('7'): API.show.slices(API.var.layer_max*7/10); break;
            case cca('8'): API.show.slices(API.var.layer_max*8/10); break;
            case cca('9'): API.show.slices(API.var.layer_max*9/10); break;
            case cca('?'):
                API.help.show();
                break;
            case cca('Z'): // reset stored state
                UC.confirm('clear all settings and preferences?').then(yes => {
                    if (yes) SDB.clear();
                });
                break;
            case cca('C'): // refresh catalog
                CATALOG.refresh();
                break;
            case cca('i'): // file import
                API.event.import();
                break;
            case cca('U'): // full settings url
                storeSettingsToServer(true);
                break;
            case cca('u'): // full settings url
                UC.prompt("settings id to load", "").then(id => {
                    if (id) loadSettingsFromServer(id);
                });
                break;
            case cca('S'): // slice
            case cca('s'): // slice
                if (evt.shiftKey) {
                    API.show.alert('CAPS lock on?');
                }
                API.function.slice();
                break;
            case cca('P'): // prepare
            case cca('p'): // prepare
                if (evt.shiftKey) {
                    API.show.alert('CAPS lock on?');
                }
                if (API.mode.get() !== 'SLA') {
                    // hidden in SLA mode
                    API.function.print();
                }
                break;
            case cca('X'): // export
            case cca('x'): // export
                if (evt.shiftKey) {
                    API.show.alert('CAPS lock on?');
                }
                API.function.export();
                break;
            case cca('g'): // CAM animate
                API.function.animate();
                break;
            case cca('o'): // manual rotation
                rotateInputSelection();
                break;
            case cca('r'): // recent files
                API.modal.show('files');
                break;
            case cca('q'): // preferences
                API.modal.show('prefs');
                break;
            case cca('l'): // device
                settingsLoad();
                break;
            case cca('e'): // device
                showDevices();
                break;
            case cca('o'): // tools
                showTools();
                break;
            case cca('c'): // local devices
                API.show.local();
                break;
            case cca('v'): // toggle single slice view mode
                if (API.var.layer_hi == API.var.layer_lo) {
                    API.var.layer_lo = 0;
                } else {
                    API.var.layer_lo = API.var.layer_hi;
                }
                API.show.slices();
                break;
            case cca('d'): // duplicate object
                sel = API.selection.meshes();
                platform.deselect();
                for (i=0; i<sel.length; i++) {
                    m = sel[i].clone();
                    m.geometry = m.geometry.clone();
                    m.material = m.material.clone();
                    bb = m.getBoundingBox();
                    let nw = API.widgets.new().loadGeometry(m.geometry);
                    nw.move(bb.max.x - bb.min.x + 1, 0, 0);
                    platform.add(nw,true);
                }
                break;
            case cca('m'): // mirror object
                API.selection.for_widgets(function(widget) {
                    widget.mirror();
                });
                SPACE.update();
                break;
            case cca('R'): // toggle slice render mode
                renderMode++;
                API.function.slice();
                break;
            case cca('a'): // auto arrange items on platform
                platform.layout();
                break;
            default:
                API.event.emit('keypress', evt);
                handled = false;
                break;
        }
        if (handled) evt.preventDefault();
        return false;
    }

    function keys(o) {
        let key, list = [];
        for (key in o) { if (o.hasOwnProperty(key)) list.push(key) }
        return list.sort();
    }

    function clearSelected(children) {
        for (let i=0; i<children.length; i++) {
            children[i].setAttribute('class','');
        }
    }

    function rotateInputSelection() {
        if (API.selection.meshes().length === 0) {
            API.show.alert("select object to rotate");
            return;
        }
        let coord = (prompt("Enter X,Y,Z degrees of rotation") || '').split(','),
            prod = Math.PI / 180,
            x = parseFloat(coord[0] || 0.0) * prod,
            y = parseFloat(coord[1] || 0.0) * prod,
            z = parseFloat(coord[2] || 0.0) * prod;

        API.selection.rotate(x, y, z);
    }

    function positionSelection() {
        if (API.selection.meshes().length === 0) {
            API.show.alert("select object to position");
            return;
        }
        let current = settings(),
            center = current.process.outputOriginCenter,
            bounds = boundsSelection(),
            coord = prompt("Enter X,Y coordinates for selection").split(','),
            x = parseFloat(coord[0] || 0.0),
            y = parseFloat(coord[1] || 0.0),
            z = parseFloat(coord[2] || 0.0);

        if (!center) {
            x = x - current.device.bedWidth/2 + (bounds.max.x - bounds.min.x)/2;
            y = y - current.device.bedDepth/2 + (bounds.max.y - bounds.min.y)/2
        }

        moveSelection(x, y, z, true);
    }

    function loadSettingsFromServer(tok) {
        let hash = (tok || LOC.hash.substring(1)).split("/");
        if (hash.length === 2) {
            new moto.Ajax(function(reply) {
                if (reply) {
                    let res = JSON.parse(reply);
                    if (res && res.ver && res.rec) {
                        let set = JSON.parse(atob(res.rec));
                        set.id = res.space;
                        set.ver = res.ver;
                        API.conf.put(set);
                        API.event.settings();
                        API.ui.sync();
                        LOC.hash = '';
                    }
                }
            }).request("/data/"+ hash[0] + "/" + hash[1]);
        }
    }

    function storeSettingsToServer(display) {
        let set = btoa(JSON.stringify(settings()));
        new moto.Ajax(function(reply) {
            if (reply) {
                let res = JSON.parse(reply);
                if (res && res.ver) {
                    LOC.hash = res.space + "/" + res.ver;
                    if (display)  {
                        UC.alert(`unique settings id is: <b>${res.space}/${res.ver}</b>`);
                    }
                }
            } else {
                updateSpaceState();
            }
        }).request("/data/"+ settings().id + "/" + settings().ver, set);
    }

    function deviceExport(exp, name) {
        name = (name || "device")
            .toLowerCase()
            .replace(/ /g,'_')
            .replace(/\./g,'_');
        UC.prompt("Export Device Filename", name).then(name => {
            if (name) {
                let blob = new Blob([exp], {type: "octet/stream"}),
                    url = WIN.URL.createObjectURL(blob);
                $('mod-any').innerHTML = `<a id="sexport" href="${url}" download="${name}.km">x</a>`;
                $('sexport').click();
            }
        });
    }

    function objectsExport() {
        // return API.selection.export();
        UC.confirm("Export Filename", {ok:true, cancel: false}, "selected.stl").then(name => {
            if (!name) return;
            if (name.toLowerCase().indexOf(".stl") < 0) {
                name = `${name}.stl`;
            }
            let xprt = API.selection.export(),
                blob = new Blob([xprt], {type: "octet/stream"}),
                url = WIN.URL.createObjectURL(blob);
            $('mod-any').innerHTML = [
                `<a id="sexport" href="${url}" download="${name}">x</a>`
            ].join('');
            $('sexport').click();
        });
    }

    function profileExport(workspace) {
        let checked = workspace ? ' checked' : '';
        const opt = {pre: [
            "<div class='f-col a-center'>",
            `  <h3>${workspace ? "Workspace" : "Profile"} Export</h3>`,
            "  <label>This will create a backup of</label>",
            workspace ?
            "  <label>your workspace and settings</label>" :
            "  <label>your device profiles and settings</label><br>",
            `  <div class='f-row' style="display:${workspace ? 'none' : ''}">`,
            `  <input id='incwork' type='checkbox'${checked}>&nbsp;include workspace`,
            "  </div>",
            "</div>"
        ]};
        UC.confirm("Export Filename", {ok:true, cancel: false}, "workspace", opt).then(name => {
            if (name) {
                let work = $('incwork').checked,
                    json = API.conf.export({work}),
                    blob = new Blob([json], {type: "octet/stream"}),
                    url = WIN.URL.createObjectURL(blob);
                $('mod-any').innerHTML = [
                    `<a id="sexport" href="${url}" download="${name}.km">x</a>`
                ].join('');
                $('sexport').click();
            }
        });
    }

    function settingsSave(ev) {
        if (ev) {
            ev.stopPropagation();
            ev.preventDefault();
        }

        API.dialog.hide();
        let mode = API.mode.get(),
            s = settings(),
            def = "default",
            cp = s.process,
            pl = s.sproc[mode],
            lp = s.cproc[mode];

        UC.prompt("Save Settings As", cp ? lp || def : def).then(name => {
            if (name) {
                let np = pl[name] = {};
                cp.processName = name;
                for (let k in cp) {
                    if (!cp.hasOwnProperty(k)) continue;
                    np[k] = cp[k];
                }
                s.devproc[s.device.deviceName] = name;
                API.conf.save();
                API.conf.update();
                API.event.settings();
            }
        });
    }

    function settingsLoad() {
        UC.hidePoppers();
        API.conf.show();
    }

    function putLocalDevice(devicename, obj) {
        settings().devices[devicename] = obj;
        API.conf.save();
    }

    function removeLocalDevice(devicename) {
        delete settings().devices[devicename];
        API.conf.save();
    }

    function isLocalDevice(devicename) {
        return settings().devices[devicename] ? true : false;
    }

    function isFavoriteDevice(devicename) {
        return settings().favorites[devicename] ? true : false;
    }

    function getSelectedDevice() {
        return UI.deviceList.options[UI.deviceList.selectedIndex].text;
    }

    function selectDevice(devicename, lock) {
        deviceLock = lock;
        if (lock) UI.setupDevices.style.display = 'none';
        if (isLocalDevice(devicename)) {
            setDeviceCode(settings().devices[devicename], devicename);
        } else {
            let code = devices[API.mode.get_lower()][devicename];
            setDeviceCode(code, devicename);
        }
    }

    // only for local filters
    function cloneDevice() {
        let name = `${getSelectedDevice()}.copy`;
        let code = API.clone(settings().device);
        code.mode = API.mode.get();
        putLocalDevice(name, code);
        setDeviceCode(code, name);
    }

    function setDeviceCode(code, devicename) {
        try {
            if (typeof(code) === 'string') code = js2o(code) || {};

            API.event.emit('device.set', devicename);

            let mode = API.mode.get(),
                current = settings(),
                local = isLocalDevice(devicename),
                dproc = current.devproc[devicename],
                dev = current.device = CONF.device_from_code(code,mode),
                proc = current.process;

            dev.new = false;
            dev.deviceName = devicename;

            UI.deviceName.value = devicename;
            UI.deviceBelt.checked = dev.bedBelt;
            UI.deviceRound.checked = dev.bedRound;
            UI.deviceOrigin.checked = dev.outputOriginCenter || dev.originCenter;

            // add extruder selection buttons
            if (dev.extruders) {
                let ext = API.lists.extruders = [];
                dev.internal = 0;
                let selext = $('pop-nozzle');
                selext.innerHTML = '';
                for (let i=0; i<dev.extruders.length; i++) {
                    let d = DOC.createElement('div');
                    d.appendChild(DOC.createTextNode(i));
                    d.setAttribute('id', `sel-ext-${i}`);
                    d.setAttribute('class', 'col j-center');
                    d.onclick = function() {
                        API.selection.for_widgets(w => {
                            API.widgets.annotate(w.id).extruder = i;
                        });
                        API.platform.update_selected();
                    };
                    selext.appendChild(d);
                    ext.push({id:i, name:i});
                }
            }

            // disable editing for non-local devices
            [
                UI.deviceName,
                UI.gcodePre,
                UI.gcodePost,
                UI.gcodePause,
                UI.bedDepth,
                UI.bedWidth,
                UI.maxHeight,
                UI.extrudeAbs,
                UI.deviceOrigin,
                UI.deviceRound,
                UI.deviceBelt,
                UI.gcodeFan,
                UI.gcodeTrack,
                UI.gcodeLayer,
                UI.extFilament,
                UI.extNozzle,
                UI.spindleMax,
                UI.gcodeSpindle,
                UI.gcodeDwell,
                UI.gcodeChange,
                UI.gcodeFExt,
                UI.gcodeSpace,
                UI.gcodeStrip,
                UI.gcodeLaserOn,
                UI.gcodeLaserOff,
                UI.extPrev,
                UI.extNext,
                UI.extAdd,
                UI.extDel,
                UI.extOffsetX,
                UI.extOffsetY,
                UI.extSelect
            ].forEach(function(e) {
                e.disabled = !local;
            });

            UI.extrudeAbs.style.display = mode === 'CAM' ? 'none' : 'flex';
            UI.deviceSave.disabled = !local;
            UI.deviceDelete.disabled = !local;
            UI.deviceAdd.disabled = dev.noclone;
            UI.deviceExport.disabled = !local;

            API.view.update_fields();
            platform.update_size();

            current.filter[mode] = devicename;
            current.cdev[mode] = currentDevice = dev;

            if (dproc) {
                // restore last process associated with this device
                API.conf.load(null, dproc);
            } else {
                API.conf.update();
            }

            API.conf.save();

            if (dev.imageURL) {
                if (dev.imageURL !== deviceURL) {
                    deviceURL = dev.imageURL;
                    loadDeviceImage(dev);
                }
            } else {
                clearDeviceTexture();
            }
        } catch (e) {
            console.log({error:e, device:code, devicename});
            API.show.alert(`invalid or deprecated device: "${devicename}"`, 10);
            API.show.alert(`please select a new device`, 10);
            throw e;
            showDevices();
        }
        API.function.clear();
        API.event.settings();
    }

    function clearDeviceTexture() {
        if (deviceImage) {
            SPACE.world.remove(deviceImage);
            deviceImage = null;
            deviceURL = null;
        }
    }

    function loadDeviceImage(dev, url) {
        new THREE.TextureLoader().load(url || dev.imageURL, texture => {
            loadDeviceTexture(dev, texture);
        }, inc => {
            console.log({load_inc: inc});
        }, error => {
            console.log({load_error: error});
        });
    }

    function loadDeviceTexture(dev, texture) {
        clearDeviceTexture();
        deviceTexture = texture;
        if (!(texture && API.conf.get().controller.decals)) {
            return;
        }
        let { width, height } = texture.image;
        let { bedWidth, bedDepth, bedHeight } = dev;
        let scale = dev.imageScale || 0.75;
        let img_ratio = width / height;
        if (scale <= 1) {
            let dev_ratio = bedWidth / bedDepth;
            if (dev_ratio > img_ratio) {
                scale *= bedDepth / height;
            } else {
                scale *= bedWidth / width;
            }
        } else if (scale > 1) {
            scale = (scale / Math.max(width, height));
        }
        width *= scale;
        height *= scale;
        let pos = null;
        if (true) switch (dev.imageAnchor) {
            case 1: pos = { x: -(bedWidth - width)/2, y:  (bedDepth - height)/2 }; break;
            case 2: pos = { x: 0,                     y:  (bedDepth - height)/2 }; break;
            case 3: pos = { x:  (bedWidth - width)/2, y:  (bedDepth - height)/2 }; break;
            case 4: pos = { x: -(bedWidth - width)/2, y:  0                     }; break;
            case 5: pos = { x:  (bedWidth - width)/2, y:  0                     }; break;
            case 6: pos = { x: -(bedWidth - width)/2, y: -(bedDepth - height)/2 }; break;
            case 7: pos = { x: 0,                     y: -(bedDepth - height)/2 }; break;
            case 8: pos = { x:  (bedWidth - width)/2, y: -(bedDepth - height)/2 }; break;
        }
        let geometry = new THREE.PlaneBufferGeometry(width, height, 1),
            material = new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
            mesh = new THREE.Mesh(geometry, material);
        mesh.position.z = -bedHeight;
        mesh.renderOrder = -1;
        if (pos) {
            mesh.position.x = pos.x;
            mesh.position.y = pos.y;
        }
        SPACE.world.add(deviceImage = mesh);
    }

    function updateDeviceName() {
        let newname = UI.deviceName.value,
            selected = API.device.get(),
            devs = settings().devices;
        if (newname !== selected) {
            devs[newname] = devs[selected];
            delete devs[selected];
            UI.deviceSave.onclick();
            selectDevice(newname);
            updateDeviceList();
        }
    }

    function renderDevices(devices) {
        let selectedIndex = -1,
            selected = API.device.get(),
            devs = settings().devices;

        for (let local in devs) {
            if (!(devs.hasOwnProperty(local) && devs[local])) {
                continue;
            }
            let dev = devs[local],
                fdmCode = dev.cmd,
                fdmMode = (API.mode.get() === 'FDM');

            if (dev.mode ? (dev.mode === API.mode.get()) : (fdmCode ? fdmMode : !fdmMode)) {
                devices.push(local);
            }
        };

        devices = devices.sort();

        UI.deviceSave.onclick = function() {
            API.function.clear();
            API.conf.save();
            showDevices();
        };
        UI.deviceAdd.onclick = function() {
            API.function.clear();
            cloneDevice();
            showDevices();
        };
        UI.deviceDelete.onclick = function() {
            API.function.clear();
            removeLocalDevice(getSelectedDevice());
            showDevices();
        };
        UI.deviceExport.onclick = function() {
            let exp = btoa(JSON.stringify({
                version: KIRI.version,
                device: selected,
                code: devs[selected],
                time: Date.now()
            }));
            deviceExport(exp, selected);
        };

        UI.deviceAll.onclick = function() {
            API.show.favorites(false);
            showDevices();
        };
        UI.deviceFavorites.onclick = function() {
            API.show.favorites(true);
            showDevices();
        };

        UI.deviceList.innerHTML = '';
        let incr = 0;
        let faves = API.show.favorites();
        let found = false;
        let first = devices[0];
        // run through the list up to twice forcing faves off
        // the second time if incr === 0 (no devices shown)
        // if incr > 0, second loop is avoided
        for (let rep=0; rep<2; rep++)
        if (incr === 0)
        devices.forEach(function(device, index) {
            // force faves off for second try
            if (rep === 1) faves = false;
            let fav = isFavoriteDevice(device),
                loc = isLocalDevice(device);
            if (faves && !(fav || loc)) {
                return;
            }
            if (incr === 0) {
                first = device;
            }
            let opt = DOC.createElement('option');
            opt.appendChild(DOC.createTextNode(device));
            opt.onclick = function() {
                selectDevice(device);
            };
            opt.ondblclick = function() {
                if (settings().favorites[device]) {
                    delete settings().favorites[device];
                    API.show.alert(`removed "${device}" from favorites`, 3);
                } else {
                    settings().favorites[device] = true;
                    API.show.alert(`added "${device}" to favorites`, 3);
                }
                showDevices();
            };
            if (loc) opt.setAttribute("local", 1);
            if (loc || fav) opt.setAttribute("favorite", 1);
            UI.deviceList.appendChild(opt);
            if (device === selected) {
                selectedIndex = incr;
                found = true;
            }
            incr++;
        });

        if (selectedIndex >= 0) {
            UI.deviceList.selectedIndex = selectedIndex;
            selectDevice(selected);
        } else {
            UI.deviceList.selectedIndex = 0;
            selectDevice(first);
        }
    }

    function renderTools() {
        UI.toolSelect.innerHTML = '';
        maxTool = 0;
        editTools.forEach(function(tool, index) {
            maxTool = Math.max(maxTool, tool.number);
            tool.order = index;
            let opt = DOC.createElement('option');
            opt.appendChild(DOC.createTextNode(tool.name));
            opt.onclick = function() { selectTool(tool) };
            UI.toolSelect.appendChild(opt);
        });
    }

    function selectTool(tool) {
        selectedTool = tool;
        UI.toolName.value = tool.name;
        UI.toolNum.value = tool.number;
        UI.toolFluteDiam.value = tool.flute_diam;
        UI.toolFluteLen.value = tool.flute_len;
        UI.toolShaftDiam.value = tool.shaft_diam;
        UI.toolShaftLen.value = tool.shaft_len;
        // UI.toolTaperAngle.value = tool.taper_angle || 70;
        UI.toolTaperTip.value = tool.taper_tip || 0;
        UI.toolMetric.checked = tool.metric;
        UI.toolType.selectedIndex = ['endmill','ballmill','tapermill'].indexOf(tool.type);
        renderTool(tool);
    }

    function otag(o) {
        if (Array.isArray(o)) {
            let out = []
            o.forEach(oe => out.push(otag(oe)));
            return out.join('');
        }
        let tags = [];
        Object.keys(o).forEach(key => {
            let val = o[key];
            let att = [];
            Object.keys(val).forEach(tk => {
                let tv = val[tk];
                att.push(`${tk.replace(/_/g,'-')}="${tv}"`);
            });
            tags.push(`<${key} ${att.join(' ')}></${key}>`);
        });
        return tags.join('');
    }

    function renderTool(tool) {
        let type = selectedTool.type;
        let taper = type === 'tapermill';
        // UI.toolTaperAngle.disabled = taper ? undefined : 'true';
        UI.toolTaperTip.disabled = taper ? undefined : 'true';
        $('tool-view').innerHTML = '<svg id="tool-svg" width="100%" height="100%"></svg>';
        setTimeout(() => {
            let svg = $('tool-svg');
            let pad = 10;
            let dim = { w: svg.clientWidth, h: svg.clientHeight }
            let max = { w: dim.w - pad * 2, h: dim.h - pad * 2};
            let off = { x: pad, y: pad };
            let shaft_fill = "#cccccc";
            let flute_fill = "#dddddd";
            let stroke = "#777777";
            let stroke_width = 3;
            let shaft = tool.shaft_len || 1;
            let flute = tool.flute_len || 1;
            let tip_len = type === "ballmill" ? tool.flute_diam / 2 : 0;
            let total_len = shaft + flute + tip_len;
            let shaft_len = (shaft / total_len) * max.h;
            let flute_len = (flute / total_len) * max.h;
            let total_wid = Math.max(tool.flute_diam, tool.shaft_diam, total_len/4);
            let shaft_off = (max.w * (1 - (tool.shaft_diam / total_wid))) / 2;
            let flute_off = (max.w * (1 - (tool.flute_diam / total_wid))) / 2;
            let taper_off = (max.w * (1 - ((tool.taper_tip || 0) / total_wid))) / 2;
            let parts = [
                { rect: {
                    x:off.x + shaft_off, y:off.y,
                    width:max.w - shaft_off * 2, height:shaft_len,
                    stroke, fill: shaft_fill, stroke_width
                } }
            ];
            if (type === "tapermill") {
                let yoff = off.y + shaft_len;
                let mid = dim.w / 2;
                parts.push({path: {stroke_width, stroke, fill:flute_fill, d:[
                    `M ${off.x + flute_off} ${yoff}`,
                    `L ${off.x + taper_off} ${yoff + flute_len}`,
                    `L ${dim.w - off.x - taper_off} ${yoff + flute_len}`,
                    `L ${dim.w - off.x - flute_off} ${yoff}`,
                    `z`
                ].join('\n')}});
            } else {
                parts.push({ rect: {
                    x:off.x + flute_off, y:off.y + shaft_len,
                    width:max.w - flute_off * 2, height:flute_len,
                    stroke, fill: flute_fill, stroke_width
                } });
            }
            if (type === "ballmill") {
                let rad = (max.w - flute_off * 2) / 2;
                let xend = dim.w - off.x - flute_off;
                let yoff = off.y + shaft_len + flute_len + stroke_width/2;
                parts.push({path: {stroke_width, stroke, fill:flute_fill, d:[
                    `M ${off.x + flute_off} ${yoff}`,
                    `A ${rad} ${rad} 0 0 0 ${xend} ${yoff}`,
                    // `L ${off.x + flute_off} ${yoff}`
                ].join('\n')}})
            }
            svg.innerHTML = otag(parts);
        }, 10);
    }

    function updateTool() {
        selectedTool.name = UI.toolName.value;
        selectedTool.number = parseInt(UI.toolNum.value);
        selectedTool.flute_diam = parseFloat(UI.toolFluteDiam.value);
        selectedTool.flute_len = parseFloat(UI.toolFluteLen.value);
        selectedTool.shaft_diam = parseFloat(UI.toolShaftDiam.value);
        selectedTool.shaft_len = parseFloat(UI.toolShaftLen.value);
        // selectedTool.taper_angle = parseFloat(UI.toolTaperAngle.value);
        selectedTool.taper_tip = parseFloat(UI.toolTaperTip.value);
        selectedTool.metric = UI.toolMetric.checked;
        selectedTool.type = ['endmill','ballmill','tapermill'][UI.toolType.selectedIndex];
        renderTools();
        UI.toolSelect.selectedIndex = selectedTool.order;
        setToolChanged(true);
        renderTool(selectedTool);
    }

    function setToolChanged(changed) {
        editTools.changed = changed;
        UI.toolsSave.disabled = !changed;
    }

    function showTools() {
        if (API.mode.get_id() !== MODES.CAM) return;

        let selectedIndex = null;

        editTools = settings().tools.slice().sort((a,b) => {
            return a.name > b.name ? 1 : -1;
        });

        setToolChanged(false);

        UI.toolsClose.onclick = function() {
            if (editTools.changed && !confirm("abandon changes?")) return;
            API.dialog.hide();
        };
        UI.toolAdd.onclick = function() {
            editTools.push({
                id: Date.now(),
                number: maxTool + 1,
                name: "new",
                type: "endmill",
                shaft_diam: 0.25,
                shaft_len: 1,
                flute_diam: 0.25,
                flute_len: 2,
                // taper_angle: 70,
                taper_tip: 0,
                metric: false
            });
            setToolChanged(true);
            renderTools();
            UI.toolSelect.selectedIndex = editTools.length-1;
            selectTool(editTools[editTools.length-1]);
        };
        UI.toolDelete.onclick = function() {
            editTools.remove(selectedTool);
            setToolChanged(true);
            renderTools();
        };
        UI.toolsSave.onclick = function() {
            if (selectedTool) updateTool();
            settings().tools = editTools.sort((a,b) => {
                return a.name < b.name ? -1 : 1;
            });
            setToolChanged(false);
            API.conf.save();
            API.view.update_fields();
            API.event.settings();
        };

        renderTools();
        if (editTools.length > 0) {
            selectTool(editTools[0]);
            UI.toolSelect.selectedIndex = 0;
        } else {
            UI.toolAdd.onclick();
        }

        API.dialog.show('tools');
        UI.toolSelect.focus();
    }

    function updateDeviceList() {
        renderDevices(Object.keys(devices[API.mode.get_lower()]).sort());
    }

    function showDevices() {
        if (deviceLock) return;
        updateDeviceList();
        API.modal.show('setup');
        UI.deviceList.focus();
    }

    function dragOverHandler(evt) {
        evt.stopPropagation();
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'copy';
        let oldcolor = SPACE.platform.setColor(0x00ff00);
        if (oldcolor !== 0x00ff00) platformColor = oldcolor;
    }

    function dragLeave() {
        SPACE.platform.setColor(platformColor);
    }

    function dropHandler(evt) {
        evt.stopPropagation();
        evt.preventDefault();

        SPACE.platform.setColor(platformColor);

        let files = evt.dataTransfer.files;

        switch (API.feature.drop_group) {
            case true:
                return API.platform.load_files(files, []);
            case false:
                return API.platform.load_files(files, undefined);
        }

        function ck_group() {
            if (files.length === 1) {
                API.platform.load_files(files);
            } else {
                UC.confirm(`group ${files.length} files?`).then(yes => {
                    API.platform.load_files(files, yes ? [] : undefined);
                });
            }
        }

        if (files.length > 5) {
            UC.confirm(`add ${files.length} objects to workspace?`).then(yes => {
                if (yes) ck_group();
            });
        } else {
            ck_group();
        }
    }

    function loadCatalogFile(e) {
        API.widgets.load(e.target.getAttribute('load'), function(widget) {
            platform.add(widget);
            API.dialog.hide();
        });
    }

    function updateCatalog(files) {
        let table = UI.catalogList,
            list = [];
        table.innerHTML = '';
        for (let name in files) {
            list.push({n:name, ln:name.toLowerCase(), v:files[name].vertices, t:files[name].updated});
        }
        list.sort(function(a,b) {
            return a.ln < b.ln ? -1 : 1;
        });
        for (let i=0; i<list.length; i++) {
            let row = DOC.createElement('div'),
                renm = DOC.createElement('button'),
                load = DOC.createElement('button'),
                size = DOC.createElement('button'),
                del = DOC.createElement('button'),
                file = list[i],
                name = file.n,
                date = new Date(file.t),
                split = name.split('.'),
                short = split[0],
                ext = split[1] ? `.${split[1]}` : '';

            renm.setAttribute('class', 'rename');
            renm.setAttribute('title', 'rename file');
            renm.innerHTML = '<i class="far fa-edit"></i>';
            renm.onclick = () => {
                let newname = prompt(`rename file`, short);
                if (newname && newname !== short) {
                    CATALOG.rename(name, `${newname}${ext}`, then => {
                        CATALOG.refresh();
                    });
                }
            };

            load.setAttribute('load', name);
            load.setAttribute('title', `file: ${name}\nvertices: ${file.v}\ndate: ${date}`);
            load.onclick = loadCatalogFile;
            load.appendChild(DOC.createTextNode(short));

            del.setAttribute('del', name);
            del.setAttribute('title', "remove '"+name+"'");
            del.onclick = () => { CATALOG.deleteFile(name) };
            del.innerHTML = '<i class="far fa-trash-alt"></i>';

            size.setAttribute("disabled", true);
            size.setAttribute("class", "label");
            size.appendChild(DOC.createTextNode(BASE.util.comma(file.v)));

            row.setAttribute("class", "f-row a-center");
            row.appendChild(renm);
            row.appendChild(load);
            row.appendChild(size);
            row.appendChild(del);
            table.appendChild(row);
        }
    }

    // MAIN INITIALIZATION FUNCTION

    function init_one() {
        API.event.emit('init.one');

        // ensure we have settings from last session
        API.conf.restore();

        let container = $('container'),
            welcome = $('welcome'),
            gcode = $('dev-gcode'),
            tracker = $('tracker'),
            controller = settings().controller;

        UC.setHoverPop(false);

        WIN.addEventListener("resize", () => {
            API.event.emit('resize');
        });

        API.event.on('resize', () => {
            if (WIN.innerHeight < 800) {
                UI.modalBox.classList.add('mh85');
            } else {
                UI.modalBox.classList.remove('mh85');
            }
            API.view.update_slider();
        });

        SPACE.showSkyGrid(false);
        SPACE.setSkyColor(controller.dark ? 0 : 0xffffff);
        SPACE.init(container, function (delta) {
            if (API.var.layer_max === 0 || !delta) return;
            if (settings().controller.reverseZoom) delta = -delta;
            let same = API.var.layer_hi === API.var.layer_lo;
            let track = API.var.layer_lo > 0;
            if (delta > 0) {
                API.var.layer_hi = Math.max(same ? 0 : API.var.layer_lo, API.var.layer_hi - 1);
                if (track) {
                    API.var.layer_lo = Math.max(0, API.var.layer_lo - 1);
                }
            } else if (delta < 0) {
                API.var.layer_hi = Math.min(API.var.layer_max, API.var.layer_hi + 1);
                if (track) {
                    API.var.layer_lo = Math.min(API.var.layer_hi, API.var.layer_lo + 1);
                }
            }
            if (same) {
                API.var.layer_lo = API.var.layer_hi;
            }
            API.view.update_slider();
            API.show.slices();
        });
        SPACE.platform.onMove(API.conf.save);
        SPACE.platform.setRound(true);
        SPACE.useDefaultKeys(API.feature.on_key === undefined || API.feature.on_key_defaults);

        Object.assign(UI, {
            alert: {
                dialog:         $('alert-area'),
                text:           $('alert-text')
            },

            func: {
                slice:          $('act-slice'),
                preview:        $('act-preview'),
                animate:        $('act-animate'),
                export:         $('act-export')
            },

            label: {
                slice:          $('label-slice'),
                preview:        $('label-preview'),
                animate:        $('label-animate'),
                export:         $('label-export'),
            },

            acct: {
                help:           $('acct-help'),
                export:         $('acct-export')
            },

            fps:                $('fps'),
            load:               $('load-file'),
            speeds:             $('speeds'),
            speedbar:           $('speedbar'),
            context:            $('context-menu'),

            container:          container,
            back:               $('lt-back'),
            trash:              $('lt-trash'),
            rotate:             $('lt-rotate'),
            scale:              $('lt-scale'),
            nozzle:             $('lt-nozzle'),
            render:             $('lt-render'),

            modal:              $('modal'),
            modalBox:           $('modal-box'),
            help:               $('mod-help'),
            setup:              $('mod-setup'),
            tools:              $('mod-tools'),
            prefs:              $('mod-prefs'),
            files:              $('mod-files'),
            saves:              $('mod-saves'),
            print:              $('mod-print'),
            local:              $('mod-local'),
            any:                $('mod-any'),

            catalogBody:        $('catalogBody'),
            catalogList:        $('catalogList'),

            devices:            $('devices'),
            deviceList:         $('device-list'),
            deviceAdd:          $('device-add'),
            deviceDelete:       $('device-del'),
            deviceExport:       $('device-exp'),
            deviceSave:         $('device-save'),
            deviceFavorites:    $('device-favorites'),
            deviceAll:          $('device-all'),

            toolsSave:          $('tools-save'),
            toolsClose:         $('tools-close'),
            toolSelect:         $('tool-select'),
            toolAdd:            $('tool-add'),
            toolDelete:         $('tool-del'),
            toolType:           $('tool-type'),
            toolName:           $('tool-name'),
            toolNum:            $('tool-num'),
            toolFluteDiam:      $('tool-fdiam'),
            toolFluteLen:       $('tool-flen'),
            toolShaftDiam:      $('tool-sdiam'),
            toolShaftLen:       $('tool-slen'),
            // toolTaperAngle: $('tool-tangle'),
            toolTaperTip:       $('tool-ttip'),
            toolMetric:         $('tool-metric'),

            setMenu:            $('set-menu'),
            settings:           $('settings'),
            settingsBody:       $('settingsBody'),
            settingsList:       $('settingsList'),

            slider:             $('slider'),
            sliderMax:          $('slider-max'),
            sliderMin:          $('slider-zero'),
            sliderLo:           $('slider-lo'),
            sliderMid:          $('slider-mid'),
            sliderHi:           $('slider-hi'),
            sliderHold:         $('slider-hold'),
            sliderRange:        $('slider-center'),

            loading:            $('progress').style,
            progress:           $('progbar').style,
            prostatus:          $('progtxt'),

            selection:          $('selection'),
            sizeX:              $('size_x'),
            sizeY:              $('size_y'),
            sizeZ:              $('size_z'),
            scaleX:             $('scale_x'),
            scaleY:             $('scale_y'),
            scaleZ:             $('scale_z'),
            lockX:              $('lock_x'),
            lockY:              $('lock_y'),
            lockZ:              $('lock_z'),
            stock:              $('stock'),
            stockWidth:         $('stock-width'),
            stockDepth:         $('stock-width'),
            stockHeight:        $('stock-width'),

            device:           UC.newGroup(LANG.dv_gr_dev, $('device'), {group:"ddev", inline:true}),
            deviceName:       UC.newInput(LANG.dv_name_s, {title:LANG.dv_name_l, size:"60%", text:true, action:updateDeviceName}),
            bedWidth:         UC.newInput(LANG.dv_bedw_s, {title:LANG.dv_bedw_l, convert:UC.toFloat, size:6, units:true}),
            bedDepth:         UC.newInput(LANG.dv_bedd_s, {title:LANG.dv_bedd_l, convert:UC.toFloat, size:6, units:true}),
            maxHeight:        UC.newInput(LANG.dv_bedh_s, {title:LANG.dv_bedh_l, convert:UC.toFloat, size:6, modes:FDM_SLA}),
            spindleMax:       UC.newInput(LANG.dv_spmx_s, {title:LANG.dv_spmx_l, convert:UC.toInt, size: 6, modes:CAM}),
            deviceOrigin:     UC.newBoolean(LANG.dv_orgc_s, onBooleanClick, {title:LANG.dv_orgc_l, modes:FDM_LASER_SLA}),
            deviceRound:      UC.newBoolean(LANG.dv_bedc_s, onBooleanClick, {title:LANG.dv_bedc_l, modes:FDM}),
            deviceBelt:       UC.newBoolean(LANG.dv_belt_s, onBooleanClick, {title:LANG.dv_belt_l, modes:FDM}),

            extruder:         UC.newGroup(LANG.dv_gr_ext, $('device'), {group:"dext", inline:true, modes:FDM}),
            extFilament:      UC.newInput(LANG.dv_fila_s, {title:LANG.dv_fila_l, convert:UC.toFloat, modes:FDM}),
            extNozzle:        UC.newInput(LANG.dv_nozl_s, {title:LANG.dv_nozl_l, convert:UC.toFloat, modes:FDM}),
            extOffsetX:       UC.newInput(LANG.dv_exox_s, {title:LANG.dv_exox_l, convert:UC.toFloat, modes:FDM, expert:true}),
            extOffsetY:       UC.newInput(LANG.dv_exoy_s, {title:LANG.dv_exoy_l, convert:UC.toFloat, modes:FDM, expert:true}),
            extSelect:        UC.newText(LANG.dv_exts_s, {title:LANG.dv_exts_l, modes:FDM, size:14, height:3, modes:FDM, expert:true, area:gcode}),
            extrudeAbs:       UC.newBoolean(LANG.dv_xtab_s, onBooleanClick, {title:LANG.dv_xtab_l, modes:FDM}),
            extActions:       UC.newRow([
                UI.extPrev = UC.newButton(undefined, undefined, {icon:'<i class="fas fa-less-than"></i>'}),
                UI.extAdd = UC.newButton(undefined, undefined, {icon:'<i class="fas fa-plus"></i>'}),
                UI.extDel = UC.newButton(undefined, undefined, {icon:'<i class="fas fa-minus"></i>'}),
                UI.extNext = UC.newButton(undefined, undefined, {icon:'<i class="fas fa-greater-than"></i>'})
            ], {modes:FDM, expert:true, class:"ext-buttons"}),

            gcode:            UC.newGroup(LANG.dv_gr_out, $('device'), {group:"dgco", inline:true, modes:CAM_LASER}),
            gcodeSpace:       UC.newBoolean(LANG.dv_tksp_s, onBooleanClick, {title:LANG.dv_tksp_l, modes:CAM_LASER}),
            gcodeStrip:       UC.newBoolean(LANG.dv_strc_s, onBooleanClick, {title:LANG.dv_strc_l, modes:CAM}),
            gcodeFExt:        UC.newInput(LANG.dv_fext_s, {title:LANG.dv_fext_l, modes:CAM_LASER, size:7, text:true}),

            gcodeEd:          UC.newGroup(LANG.dv_gr_gco, $('dg'), {group:"dgcp", inline:true, modes:GCODE}),
            gcodeFanTrack: UC.newRow([
                (UI.gcodeFan = UC.newGCode(LANG.dv_fanp_s, {title:LANG.dv_fanp_l, modes:FDM, area:gcode})).button,
                (UI.gcodeTrack = UC.newGCode(LANG.dv_prog_s, {title:LANG.dv_prog_l, modes:FDM, area:gcode})).button
            ], {modes:FDM, class:"ext-buttons f-row"}),
            gcodeLayerPause: UC.newRow([
                (UI.gcodeLayer = UC.newGCode(LANG.dv_layr_s, {title:LANG.dv_layr_l, modes:FDM, area:gcode})).button,
                (UI.gcodePause = UC.newGCode(LANG.dv_paus_s, {title:LANG.dv_paus_l, modes:FDM, area:gcode})).button
            ], {modes:FDM, class:"ext-buttons f-row"}),
            gcodeLaserOnOff: UC.newRow([
                (UI.gcodeLaserOn = UC.newGCode(LANG.dv_lzon_s, {title:LANG.dv_lzon_l, modes:LASER, area:gcode})).button,
                (UI.gcodeLaserOff = UC.newGCode(LANG.dv_lzof_s, {title:LANG.dv_lzof_l, modes:LASER, area:gcode})).button,
            ], {modes:LASER, class:"ext-buttons f-row"}),
            gcodeCam1: UC.newRow([
                (UI.gcodeChange = UC.newGCode(LANG.dv_tool_s, {title:LANG.dv_tool_l, modes:CAM, area:gcode})).button
            ], {modes:CAM, class:"ext-buttons f-row"}),
            gcodeCam2: UC.newRow([
                (UI.gcodeDwell = UC.newGCode(LANG.dv_dwll_s, {title:LANG.dv_dwll_l, modes:CAM, area:gcode})).button,
                (UI.gcodeSpindle = UC.newGCode(LANG.dv_sspd_s, {title:LANG.dv_sspd_l, modes:CAM, area:gcode})).button
            ], {modes:CAM, class:"ext-buttons f-row"}),
            gcodeHeadFoot: UC.newRow([
                (UI.gcodePre = UC.newGCode(LANG.dv_head_s, {title:LANG.dv_head_l, modes:GCODE, area:gcode})).button,
                (UI.gcodePost = UC.newGCode(LANG.dv_foot_s, {title:LANG.dv_foot_l, modes:GCODE, area:gcode})).button
            ], {modes:GCODE, class:"ext-buttons f-row"}),

            lprefs:           UC.newGroup(LANG.op_menu, $('prefs-gen1'), {inline: true}),
            // hoverPop:         UC.newBoolean(LANG.op_hopo_s, booleanSave, {title:LANG.op_hopo_l}),
            reverseZoom:      UC.newBoolean(LANG.op_invr_s, booleanSave, {title:LANG.op_invr_l}),
            dark:             UC.newBoolean(LANG.op_dark_s, booleanSave, {title:LANG.op_dark_l}),
            decals:           UC.newBoolean(LANG.op_decl_s, booleanSave, {title:LANG.op_decl_s}),
            expert:           UC.newBoolean(LANG.op_xprt_s, booleanSave, {title:LANG.op_xprt_l}),

            lprefs:           UC.newGroup(LANG.op_disp, $('prefs-gen2'), {inline: true}),
            showOrigin:       UC.newBoolean(LANG.op_shor_s, booleanSave, {title:LANG.op_shor_l}),
            showRulers:       UC.newBoolean(LANG.op_shru_s, booleanSave, {title:LANG.op_shru_l}),
            showSpeeds:       UC.newBoolean(LANG.op_sped_s, speedSave, {title:LANG.op_sped_l}),
            lineType:         UC.newSelect(LANG.op_line_s, {title: LANG.op_line_l, action: lineTypeSave, modes:FDM}, "linetype"),
            animesh:          UC.newSelect(LANG.op_anim_s, {title: LANG.op_anim_l, action: aniMeshSave, modes:CAM}, "animesh"),
            units:            UC.newSelect(LANG.op_unit_s, {title: LANG.op_unit_l, action:unitsSave, modes:CAM, trace:true}, "units"),

            layout:           UC.newGroup(LANG.lo_menu, $('prefs-lay'), {inline: true}),
            alignTop:         UC.newBoolean(LANG.op_alig_s, booleanSave, {title:LANG.op_alig_l}),
            autoLayout:       UC.newBoolean(LANG.op_auto_s, booleanSave, {title:LANG.op_auto_l}),
            freeLayout:       UC.newBoolean(LANG.op_free_s, booleanSave, {title:LANG.op_free_l}),
            autoSave:         UC.newBoolean(LANG.op_save_s, booleanSave, {title:LANG.op_save_l}),

            export:           UC.newGroup(LANG.xp_menu, $('prefs-xpo'), {inline: true}),
            exportOcto:       UC.newBoolean(`OctoPrint`, booleanSave),
            exportGhost:      UC.newBoolean(`Grid:Host`, booleanSave),
            exportLocal:      UC.newBoolean(`Grid:Local`, booleanSave),
            exportPreview:    UC.newBoolean(`Code Preview`, booleanSave),

            parts:            UC.newGroup(LANG.pt_menu, $('prefs-prt'), {inline: true}),
            detail:           UC.newSelect(LANG.pt_qual_s, {title: LANG.pt_qual_l, action: detailSave}, "detail"),
            decimate:         UC.newBoolean(LANG.pt_deci_s, booleanSave, {title: LANG.pt_deci_l}),

            prefadd:          UC.checkpoint($('prefs-add')),

            process:             UC.newGroup(LANG.sl_menu, $('settings'), {modes:FDM_LASER}),
            sliceHeight:         UC.newInput(LANG.sl_lahi_s, {title:LANG.sl_lahi_l, convert:UC.toFloat, modes:FDM}),
            sliceMinHeight:      UC.newInput(LANG.ad_minl_s, {title:LANG.ad_minl_l, bound:UC.bound(0,3.0), convert:UC.toFloat, modes:FDM, expert:true, show: () => UI.sliceAdaptive.checked}),
            fdmSep:              UC.newBlank({class:"pop-sep", modes:FDM}),
            sliceShells:         UC.newInput(LANG.sl_shel_s, {title:LANG.sl_shel_l, convert:UC.toInt, modes:FDM}),
            sliceTopLayers:      UC.newInput(LANG.sl_ltop_s, {title:LANG.sl_ltop_l, convert:UC.toInt, modes:FDM}),
            sliceSolidLayers:    UC.newInput(LANG.sl_lsld_s, {title:LANG.sl_lsld_l, convert:UC.toInt, modes:FDM}),
            sliceBottomLayers:   UC.newInput(LANG.sl_lbot_s, {title:LANG.sl_lbot_l, convert:UC.toInt, modes:FDM}),
            fdmSep:              UC.newBlank({class:"pop-sep", modes:FDM}),
            sliceAdaptive:       UC.newBoolean(LANG.ad_adap_s, onBooleanClick, {title: LANG.ad_adap_l, modes:FDM, expert:true, trigger: true}),
            detectThinWalls:     UC.newBoolean(LANG.ad_thin_s, onBooleanClick, {title: LANG.ad_thin_l, modes:FDM, expert:true}),

            laserOffset:         UC.newInput(LANG.ls_offs_s, {title:LANG.ls_offs_l, convert:UC.toFloat, modes:LASER}),
            laserSliceHeight:    UC.newInput(LANG.ls_lahi_s, {title:LANG.ls_lahi_l, convert:UC.toFloat, modes:LASER, trigger: true}),
            laserSliceHeightMin: UC.newInput(LANG.ls_lahm_s, {title:LANG.ls_lahm_l, convert:UC.toFloat, modes:LASER, show:() => { return UI.laserSliceHeight.value == 0 }}),
            laserSliceSingle:    UC.newBoolean(LANG.ls_sngl_s, onBooleanClick, {title:LANG.ls_sngl_l, modes:LASER}),

            firstLayer:          UC.newGroup(LANG.fl_menu, null, {modes:FDM}),
            firstSliceHeight:    UC.newInput(LANG.fl_lahi_s, {title:LANG.fl_lahi_l, convert:UC.toFloat, modes:FDM}),
            fdmSep:              UC.newBlank({class:"pop-sep", modes:FDM}),
            firstLayerNozzleTemp:UC.newInput(LANG.fl_nozl_s, {title:LANG.fl_nozl_l, convert:UC.toInt, modes:FDM, expert:true}),
            firstLayerBedTemp:   UC.newInput(LANG.fl_bedd_s, {title:LANG.fl_bedd_l, convert:UC.toInt, modes:FDM, expert:true}),
            fdmSep:              UC.newBlank({class:"pop-sep", modes:FDM}),
            firstLayerRate:      UC.newInput(LANG.fl_rate_s, {title:LANG.fl_rate_l, convert:UC.toFloat, modes:FDM}),
            firstLayerFillRate:  UC.newInput(LANG.fl_frat_s, {title:LANG.fl_frat_l, convert:UC.toFloat, modes:FDM}),
            firstLayerPrintMult: UC.newInput(LANG.fl_mult_s, {title:LANG.fl_mult_l, convert:UC.toFloat, modes:FDM, expert:true}),
            fdmSep:              UC.newBlank({class:"pop-sep", modes:FDM}),
            outputBrimCount:     UC.newInput(LANG.fl_skrt_s, {title:LANG.fl_skrt_l, convert:UC.toInt, modes:FDM}),
            outputBrimOffset:    UC.newInput(LANG.fl_skro_s, {title:LANG.fl_skro_l, convert:UC.toFloat, modes:FDM}),
            fdmSep:              UC.newBlank({class:"pop-sep", modes:FDM}),
            outputRaftSpacing:   UC.newInput(LANG.fr_spac_s, {title:LANG.fr_spac_l, convert:UC.toFloat, bound:UC.bound(0.0,3.0), modes:FDM, show: () => UI.outputRaft.checked }),
            outputRaft:          UC.newBoolean(LANG.fr_nabl_s, onBooleanClick, {title:LANG.fr_nabl_l, modes:FDM, trigger: true}),

            fdmInfill:           UC.newGroup(LANG.fi_menu, $('settings'), {modes:FDM}),
            sliceFillType:       UC.newSelect(LANG.fi_type, {modes:FDM}, "infill"),
            fdmSep:              UC.newBlank({class:"pop-sep", modes:FDM}),
            sliceFillSparse:     UC.newInput(LANG.fi_pcnt_s, {title:LANG.fi_pcnt_l, convert:UC.toFloat, bound:UC.bound(0.0,1.0), modes:FDM}),
            sliceFillAngle:      UC.newInput(LANG.fi_angl_s, {title:LANG.fi_angl_l, convert:UC.toFloat, modes:FDM, expert:true}),
            sliceFillOverlap:    UC.newInput(LANG.fi_over_s, {title:LANG.fi_over_l, convert:UC.toFloat, bound:UC.bound(0.0,2.0), modes:FDM, expert:true}),

            fdmSupport:          UC.newGroup(LANG.sp_menu, null, {modes:FDM, marker:true}),
            sliceSupportDensity: UC.newInput(LANG.sp_dens_s, {title:LANG.sp_dens_l, convert:UC.toFloat, bound:UC.bound(0.05,1.0), modes:FDM}),
            fdmSep:              UC.newBlank({class:"pop-sep", modes:FDM}),
            sliceSupportSize:    UC.newInput(LANG.sp_size_s, {title:LANG.sp_size_l, bound:UC.bound(1.0,200.0), convert:UC.toFloat, modes:FDM}),
            sliceSupportOffset:  UC.newInput(LANG.sp_offs_s, {title:LANG.sp_offs_l, bound:UC.bound(0.0,200.0), convert:UC.toFloat, modes:FDM}),
            sliceSupportGap:     UC.newInput(LANG.sp_gaps_s, {title:LANG.sp_gaps_l, bound:UC.bound(0,5), convert:UC.toInt, modes:FDM, expert:true}),
            fdmSep:              UC.newBlank({class:"pop-sep", modes:FDM}),
            sliceSupportArea:    UC.newInput(LANG.sp_area_s, {title:LANG.sp_area_l, bound:UC.bound(0.0,200.0), convert:UC.toFloat, modes:FDM}),
            sliceSupportExtra:   UC.newInput(LANG.sp_xpnd_s, {title:LANG.sp_xpnd_l, bound:UC.bound(0.0,200.0), convert:UC.toFloat, modes:FDM, expert:true}),
            sliceSupportNozzle:  UC.newSelect(LANG.sp_nozl_s, {title:LANG.sp_nozl_l, modes:FDM, expert:true}, "extruders"),
            fdmSep:              UC.newBlank({class:"pop-sep", modes:FDM}),
            sliceSupportSpan:    UC.newInput(LANG.sp_span_s, {title:LANG.sp_span_l, bound:UC.bound(0.0,200.0), convert:UC.toFloat, modes:FDM, show: () => UI.sliceSupportEnable.checked}),
            sliceSupportEnable:  UC.newBoolean(LANG.sp_auto_s, onBooleanClick, {title: LANG.sp_auto_l, modes:FDM, trigger:true}),

            fdmSep:              UC.newBlank({class:"pop-sep", modes:FDM}),
            sliceSupportManual: UC.newRow([
                (UI.ssmAdd = UC.newButton(undefined, onButtonClick, {icon:'<i class="fas fa-plus"></i>'})),
                (UI.ssmDun = UC.newButton(undefined, onButtonClick, {icon:'<i class="fas fa-check"></i>'})),
                (UI.ssmClr = UC.newButton(undefined, onButtonClick, {icon:'<i class="fas fa-trash-alt"></i>'}))
            ], {modes:FDM, class:"ext-buttons f-row"}),

            camRough:           UC.newGroup(LANG.cr_menu, null, {modes:CAM, marker:true, top:true}),
            camRoughTool:       UC.newSelect(LANG.cc_tool, {modes:CAM}),
            camRoughSpindle:    UC.newInput(LANG.cc_spnd_s, {title:LANG.cc_spnd_l, convert:UC.toInt, modes:CAM, visible:spindleShow}),
            camRoughOver:       UC.newInput(LANG.cc_sovr_s, {title:LANG.cc_sovr_l, convert:UC.toFloat, bound:UC.bound(0.01,1.0), modes:CAM}),
            camRoughDown:       UC.newInput(LANG.cc_sdwn_s, {title:LANG.cc_sdwn_l, convert:UC.toFloat, modes:CAM, units:true}),
            camRoughSpeed:      UC.newInput(LANG.cc_feed_s, {title:LANG.cc_feed_l, convert:UC.toInt, modes:CAM, units:true}),
            camRoughPlunge:     UC.newInput(LANG.cc_plng_s, {title:LANG.cc_plng_l, convert:UC.toInt, modes:CAM, units:true}),
            camRoughStock:      UC.newInput(LANG.cr_lsto_s, {title:LANG.cr_lsto_l, convert:UC.toFloat, modes:CAM, units:true}),
            camRoughVoid:       UC.newBoolean(LANG.cr_clrp_s, onBooleanClick, {title:LANG.cr_clrp_l, modes:CAM}),
            camRoughFlat:       UC.newBoolean(LANG.cr_clrf_s, onBooleanClick, {title:LANG.cr_clrf_l, modes:CAM}),
            camRoughTop:        UC.newBoolean(LANG.cr_clrt_s, onBooleanClick, {title:LANG.cr_clrt_l, modes:CAM}),
            camRoughIn:         UC.newBoolean(LANG.cr_olin_s, onBooleanClick, {title:LANG.cr_olin_l, modes:CAM}),
            camRoughSep:        UC.newBlank({class:"pop-sep"}),
            camRoughOn:         UC.newBoolean(LANG.enable, onBooleanClick, {modes:CAM}),
            camOutline:         UC.newGroup(LANG.co_menu, null, {modes:CAM, marker:true}),
            camOutlineTool:     UC.newSelect(LANG.cc_tool, {modes:CAM}),
            camOutlineSpindle:  UC.newInput(LANG.cc_spnd_s, {title:LANG.cc_spnd_l, convert:UC.toInt, modes:CAM, visible:spindleShow}),
            camOutlineDown:     UC.newInput(LANG.cc_sdwn_s, {title:LANG.cc_sdwn_l, convert:UC.toFloat, modes:CAM, units:true}),
            camOutlineSpeed:    UC.newInput(LANG.cc_feed_s, {title:LANG.cc_feed_l, convert:UC.toInt, modes:CAM, units:true}),
            camOutlinePlunge:   UC.newInput(LANG.cc_plng_s, {title:LANG.cc_plng_l, convert:UC.toInt, modes:CAM, units:true}),
            camOutlineDogbone:  UC.newBoolean(LANG.co_dogb_s, onBooleanClick, {title:LANG.co_dogb_l, modes:CAM, show:() => { return !UI.camOutlineWide.checked }}),
            camOutlineIn:       UC.newBoolean(LANG.co_olin_s, onBooleanClick, {title:LANG.co_olin_l, modes:CAM, show:() => { return !UI.camOutlineOut.checked }}),
            camOutlineOut:      UC.newBoolean(LANG.co_olot_s, onBooleanClick, {title:LANG.co_olot_l, modes:CAM, show:() => { return !UI.camOutlineIn.checked }}),
            camOutlineWide:     UC.newBoolean(LANG.co_wide_s, onBooleanClick, {title:LANG.co_wide_l, modes:CAM, show:() => { return !UI.camOutlineIn.checked }}),
            camOutlineSep2:     UC.newBlank({class:"pop-sep"}),
            camOutlineOcRadius: UC.newInput(LANG.co_ocrd_s, {title:LANG.co_ocrd_l, convert:UC.toInt, modes:CAM, units:true}),
            camOutlineOvercut:  UC.newRow([
                (UI.overcutAdd = UC.newButton(undefined, onButtonClick, {icon:'<i class="fas fa-plus"></i>'})),
                (UI.overcutDun = UC.newButton(undefined, onButtonClick, {icon:'<i class="fas fa-check"></i>'})),
                (UI.overcutClr = UC.newButton(undefined, onButtonClick, {icon:'<i class="fas fa-trash-alt"></i>'}))],
                {modes:CAM, class:"ext-buttons f-row", show:() => { return UI.camOutlineOcRadius.value != 0 }}),
            camOutlineSep:      UC.newBlank({class:"pop-sep"}),
            camOutlineOn:       UC.newBoolean(LANG.co_olen_s, onBooleanClick, {title:LANG.co_olen_l, modes:CAM}),
            camContour:         UC.newGroup(LANG.cn_menu, null, {modes:CAM, marker:true}),
            camContourTool:     UC.newSelect(LANG.cc_tool, {modes:CAM}),
            camContourSpindle:  UC.newInput(LANG.cc_spnd_s, {title:LANG.cc_spnd_l, convert:UC.toInt, modes:CAM, visible:spindleShow}),
            camContourOver:     UC.newInput(LANG.cc_sovr_s, {title:LANG.cc_sovr_l, convert:UC.toFloat, bound:UC.bound(0.05,1.0), modes:CAM}),
            camContourSpeed:    UC.newInput(LANG.cc_feed_s, {title:LANG.cc_feed_l, convert:UC.toInt, modes:CAM, units:true}),
            camContourAngle:    UC.newInput(LANG.cf_angl_s, {title:LANG.cf_angl_l, convert:UC.toFloat, bound:UC.bound(45,90), modes:CAM}),
            camTolerance:       UC.newInput(LANG.ou_toll_s, {title:LANG.ou_toll_l, convert:UC.toFloat, bound:UC.bound(0,10.0), modes:CAM, units:true}),
            camContourCurves:   UC.newBoolean(LANG.cf_curv_s, onBooleanClick, {title:LANG.cf_curv_l, modes:CAM}),
            camContourIn:       UC.newBoolean(LANG.cf_olin_s, onBooleanClick, {title:LANG.cf_olin_l, modes:CAM}),
            camContourSep:      UC.newBlank({class:"pop-sep"}),
            camContourYOn:      UC.newBoolean(LANG.cf_liny_s, onBooleanClick, {title:LANG.cf_liny_l, modes:CAM}),
            camContourXOn:      UC.newBoolean(LANG.cf_linx_s, onBooleanClick, {title:LANG.cf_linx_l, modes:CAM}),
            camTracing:         UC.newGroup(LANG.cu_menu, null, {modes:CAM, marker:true}),
            camTraceTool:       UC.newSelect(LANG.cc_tool, {modes:CAM}),
            camTraceType:       UC.newSelect(LANG.cu_type_s, {title:LANG.cu_type_l, modes:CAM}, "trace"),
            camTraceSpeed:      UC.newInput(LANG.cc_feed_s, {title:LANG.cc_feed_l, convert:UC.toInt, modes:CAM}),
            camTracePlunge:     UC.newInput(LANG.cc_plng_s, {title:LANG.cc_plng_l, convert:UC.toFloat, modes:CAM, units:true}),
            camTraceSep:        UC.newBlank({class:"pop-sep"}),
            camTraceSelect: UC.newRow([
                (UI.traceAdd = UC.newButton(undefined, onButtonClick, {icon:'<i class="fas fa-plus"></i>'})),
                (UI.traceDun = UC.newButton(undefined, onButtonClick, {icon:'<i class="fas fa-check"></i>'})),
                (UI.traceClr = UC.newButton(undefined, onButtonClick, {icon:'<i class="fas fa-trash-alt"></i>'}))
            ], {modes:CAM, class:"ext-buttons f-row"}),
            camTabs:             UC.newGroup(LANG.ct_menu, null, {modes:CAM, marker:true}),
            camTabsWidth:        UC.newInput(LANG.ct_wdth_s, {title:LANG.ct_wdth_l, convert:UC.toFloat, bound:UC.bound(0.005,100), modes:CAM, units:true}),
            camTabsHeight:       UC.newInput(LANG.ct_hght_s, {title:LANG.ct_hght_l, convert:UC.toFloat, bound:UC.bound(0.005,100), modes:CAM, units:true}),
            camTabsDepth:        UC.newInput(LANG.ct_dpth_s, {title:LANG.ct_dpth_l, convert:UC.toFloat, bound:UC.bound(0.005,100), modes:CAM, units:true}),
            camTabSep:           UC.newBlank({class:"pop-sep"}),
            camTabsManual: UC.newRow([
                (UI.tabAdd = UC.newButton(undefined, onButtonClick, {icon:'<i class="fas fa-plus"></i>'})),
                (UI.tabDun = UC.newButton(undefined, onButtonClick, {icon:'<i class="fas fa-check"></i>'})),
                (UI.tabClr = UC.newButton(undefined, onButtonClick, {icon:'<i class="fas fa-trash-alt"></i>'}))
            ], {modes:CAM, class:"ext-buttons f-row"}),
            camDrill:            UC.newGroup(LANG.cd_menu, null, {modes:CAM, marker:true}),
            camDrillTool:        UC.newSelect(LANG.cc_tool, {modes:CAM}),
            camDrillSpindle:     UC.newInput(LANG.cc_spnd_s, {title:LANG.cc_spnd_l, convert:UC.toInt, modes:CAM, visible:spindleShow}),
            camDrillDown:        UC.newInput(LANG.cd_plpr_s, {title:LANG.cd_plpr_l, convert:UC.toFloat, modes:CAM, units:true}),
            camDrillDownSpeed:   UC.newInput(LANG.cc_plng_s, {title:LANG.cc_plng_l, convert:UC.toFloat, modes:CAM, units:true}),
            camDrillDwell:       UC.newInput(LANG.cd_dwll_s, {title:LANG.cd_dwll_l, convert:UC.toFloat, modes:CAM}),
            camDrillLift:        UC.newInput(LANG.cd_lift_s, {title:LANG.cd_lift_l, convert:UC.toFloat, modes:CAM, units:true}),
            camDrillSep:         UC.newBlank({class:"pop-sep"}),
            camDrillingOn:       UC.newBoolean(LANG.enable, onBooleanClick, {modes:CAM}),
            camDrillSep:         UC.newBlank({class:"pop-sep"}),
            camDrillReg:         UC.newSelect(LANG.cd_regi_s, {modes:CAM, title:LANG.cd_regi_l}, "drillreg"),

            camSep1:             UC.newGroup(null, null, {modes:CAM, class:"set-sep"}),
            camStock:            UC.newGroup(LANG.cs_menu, null, {modes:CAM, marker: true}),
            camStockX:           UC.newInput(LANG.cs_wdth_s, {title:LANG.cs_wdth_l, convert:UC.toFloat, bound:UC.bound(0,9999), modes:CAM, units:true}),
            camStockY:           UC.newInput(LANG.cs_dpth_s, {title:LANG.cs_dpth_l, convert:UC.toFloat, bound:UC.bound(0,9999), modes:CAM, units:true}),
            camStockZ:           UC.newInput(LANG.cs_hght_s, {title:LANG.cs_hght_l, convert:UC.toFloat, bound:UC.bound(0,9999), modes:CAM, units:true}),
            camStockOffset:      UC.newBoolean(LANG.cs_offs_s, onBooleanClick, {title:LANG.cs_offs_l, modes:CAM}),
            camStockSep:         UC.newBlank({class:"pop-sep"}),
            camStockOn:          UC.newBoolean(LANG.cs_offe_s, onBooleanClick, {title:LANG.cs_offe_l, modes:CAM}),

            camCommon:           UC.newGroup(LANG.cc_menu, null, {modes:CAM}),
            camZTopOffset:       UC.newInput(LANG.ou_ztof_s, {title:LANG.ou_ztof_l, convert:UC.toFloat, modes:CAM, units:true}),
            camZBottom:          UC.newInput(LANG.ou_zbot_s, {title:LANG.ou_zbot_l, convert:UC.toFloat, modes:CAM, units:true, trigger: true}),
            camZClearance:       UC.newInput(LANG.ou_zclr_s, {title:LANG.ou_zclr_l, convert:UC.toFloat, bound:UC.bound(0.01,100), modes:CAM, units:true}),
            camZThru:            UC.newInput(LANG.ou_ztru_s, {title:LANG.ou_ztru_l, convert:UC.toFloat, bound:UC.bound(0.0,100), modes:CAM, units:true, show:() => { return UI.camZBottom.value == 0 }}),
            camFastFeedZ:        UC.newInput(LANG.cc_rzpd_s, {title:LANG.cc_rzpd_l, convert:UC.toFloat, modes:CAM, units:true}),
            camFastFeed:         UC.newInput(LANG.cc_rapd_s, {title:LANG.cc_rapd_l, convert:UC.toFloat, modes:CAM, units:true}),

            laserLayout:         UC.newGroup(LANG.lo_menu, null, {modes:LASER, group:"lz-lo"}),
            outputTileSpacing:   UC.newInput(LANG.ou_spac_s, {title:LANG.ou_spac_l, convert:UC.toInt, modes:LASER}),
            outputLaserMerged:   UC.newBoolean(LANG.ou_mrgd_s, onBooleanClick, {title:LANG.ou_mrgd_l, modes:LASER}),
            outputLaserGroup:    UC.newBoolean(LANG.ou_grpd_s, onBooleanClick, {title:LANG.ou_grpd_l, modes:LASER}),

            knife:               UC.newGroup(LANG.dk_menu, null, {modes:LASER, marker:true}),
            outputKnifeDepth:    UC.newInput(LANG.dk_dpth_s, {title:LANG.dk_dpth_l, convert:UC.toFloat, bound:UC.bound(0.0,5.0), modes:LASER}),
            outputKnifePasses:   UC.newInput(LANG.dk_pass_s, {title:LANG.dk_pass_l, convert:UC.toInt, bound:UC.bound(0,5), modes:LASER}),
            outputKnifeTip:      UC.newInput(LANG.dk_offs_s, {title:LANG.dk_offs_l, convert:UC.toFloat, bound:UC.bound(0.0,10.0), modes:LASER}),
            knifeSep:            UC.newBlank({class:"pop-sep", modes:LASER}),
            knifeOn:            UC.newBoolean(LANG.enable, onBooleanClick, {title:LANG.ou_drkn_l, modes:LASER}),

            output:              UC.newGroup(LANG.ou_menu, null, {modes:GCODE}),
            outputLaserPower:    UC.newInput(LANG.ou_powr_s, {title:LANG.ou_powr_l, convert:UC.toInt, bound:UC.bound(1,100), modes:LASER}),
            outputLaserSpeed:    UC.newInput(LANG.ou_sped_s, {title:LANG.ou_sped_l, convert:UC.toInt, modes:LASER}),
            outputLaserZColor:   UC.newBoolean(LANG.ou_layo_s, onBooleanClick, {title:LANG.ou_layo_l, modes:LASER, show:() => { return UI.outputLaserMerged.checked === false }}),
            outputLaserLayer:    UC.newBoolean(LANG.ou_layr_s, onBooleanClick, {title:LANG.ou_layr_l, modes:LASER}),

            outputTemp:          UC.newInput(LANG.ou_nozl_s, {title:LANG.ou_nozl_l, convert:UC.toInt, modes:FDM}),
            outputBedTemp:       UC.newInput(LANG.ou_bedd_s, {title:LANG.ou_bedd_l, convert:UC.toInt, modes:FDM}),
            fdmSep:              UC.newBlank({class:"pop-sep", modes:FDM}),
            outputFeedrate:      UC.newInput(LANG.ou_feed_s, {title:LANG.ou_feed_l, convert:UC.toInt, modes:FDM}),
            outputFinishrate:    UC.newInput(LANG.ou_fini_s, {title:LANG.ou_fini_l, convert:UC.toInt, modes:FDM}),
            outputSeekrate:      UC.newInput(LANG.ou_move_s, {title:LANG.ou_move_l, convert:UC.toInt, modes:FDM}),
            fdmSep:              UC.newBlank({class:"pop-sep", modes:FDM}),
            outputShellMult:     UC.newInput(LANG.ou_shml_s, {title:LANG.ou_exml_l, convert:UC.toFloat, bound:UC.bound(0.0,2.0), modes:FDM}),
            outputFillMult:      UC.newInput(LANG.ou_flml_s, {title:LANG.ou_exml_l, convert:UC.toFloat, bound:UC.bound(0.0,2.0), modes:FDM}),
            outputSparseMult:    UC.newInput(LANG.ou_spml_s, {title:LANG.ou_exml_l, convert:UC.toFloat, bound:UC.bound(0.0,2.0), modes:FDM}),
            fdmSep:              UC.newBlank({class:"pop-sep", modes:FDM}),
            outputFanLayer:      UC.newInput(LANG.ou_fanl_s, {title:LANG.ou_fanl_l, convert:UC.toInt, bound:UC.bound(0,100), modes:FDM, expert:true}),
            sliceShellOrder:     UC.newSelect(LANG.sl_ordr_s, {title:LANG.sl_ordr_l, modes:FDM}, "shell"),
            camConventional:     UC.newBoolean(LANG.ou_conv_s, onBooleanClick, {title:LANG.ou_conv_l, modes:CAM}),
            camEaseDown:         UC.newBoolean(LANG.cr_ease_s, onBooleanClick, {title:LANG.cr_ease_l, modes:CAM}),
            camDepthFirst:       UC.newBoolean(LANG.ou_depf_s, onBooleanClick, {title:LANG.ou_depf_l, modes:CAM}),
            outputOriginBounds:  UC.newBoolean(LANG.or_bnds_s, onBooleanClick, {title:LANG.or_bnds_l, modes:LASER}),
            outputOriginCenter:  UC.newBoolean(LANG.or_cntr_s, onBooleanClick, {title:LANG.or_cntr_l, modes:CAM_LASER}),
            camOriginTop:        UC.newBoolean(LANG.or_topp_s, onBooleanClick, {title:LANG.or_topp_l, modes:CAM}),

            advanced:            UC.newGroup(LANG.ad_menu, null, {modes:FDM, expert:true}),
            outputRetractDist:   UC.newInput(LANG.ad_rdst_s, {title:LANG.ad_rdst_l, convert:UC.toFloat, modes:FDM, expert:true}),
            outputRetractSpeed:  UC.newInput(LANG.ad_rrat_s, {title:LANG.ad_rrat_l, convert:UC.toInt, modes:FDM, expert:true}),
            outputRetractDwell:  UC.newInput(LANG.ad_rdwl_s, {title:LANG.ad_rdwl_l, convert:UC.toInt, modes:FDM, expert:true}),
            fdmSep:              UC.newBlank({class:"pop-sep", modes:FDM}),
            // outputWipeDistance: UC.newInput("wipe", {title:"non-printing move at\close of polygon\nin millimeters", bound:UC.bound(0.0,10), convert:UC.toFloat, modes:FDM, expert:true}),
            sliceSolidMinArea:   UC.newInput(LANG.ad_msol_s, {title:LANG.ad_msol_l, convert:UC.toFloat, modes:FDM, expert:true}),
            outputMinSpeed:      UC.newInput(LANG.ad_mins_s, {title:LANG.ad_mins_l, bound:UC.bound(5,200), convert:UC.toFloat, modes:FDM, expert:true}),
            outputCoastDist:     UC.newInput(LANG.ad_scst_s, {title:LANG.ad_scst_l, bound:UC.bound(0.0,10), convert:UC.toFloat, modes:FDM, expert:true}),
            outputShortPoly:     UC.newInput(LANG.ad_spol_s, {title:LANG.ad_spol_l, bound:UC.bound(0,10000), convert:UC.toFloat, modes:FDM, expert:true}),
            fdmSep:              UC.newBlank({class:"pop-sep", modes:FDM}),
            zHopDistance:        UC.newInput(LANG.ad_zhop_s, {title:LANG.ad_zhop_l, bound:UC.bound(0,3.0), convert:UC.toFloat, modes:FDM, expert:true}),
            antiBacklash:        UC.newInput(LANG.ad_abkl_s, {title:LANG.ad_abkl_l, bound:UC.bound(0,3), convert:UC.toInt, modes:FDM, expert:true}),
            fdmSep:              UC.newBlank({class:"pop-sep", modes:FDM}),
            gcodePauseLayers:    UC.newInput(LANG.ag_paws_s, {title:LANG.ag_paws_l, modes:FDM, expert:true, comma:true}),
            outputLayerRetract:  UC.newBoolean(LANG.ad_lret_s, onBooleanClick, {title:LANG.ad_lret_l, modes:FDM, expert:true}),

            // SLA
            slaProc:             UC.newGroup(LANG.sa_menu, null, {modes:SLA, group:"sla-slice"}),
            slaSlice:            UC.newInput(LANG.sa_lahe_s, {title:LANG.sa_lahe_l, convert:UC.toFloat, modes:SLA}),
            slaShell:            UC.newInput(LANG.sa_shel_s, {title:LANG.sa_shel_l, convert:UC.toFloat, modes:SLA}),
            slaOpenTop:          UC.newBoolean(LANG.sa_otop_s, onBooleanClick, {title:LANG.sa_otop_l, modes:SLA}),
            slaOpenBase:         UC.newBoolean(LANG.sa_obas_s, onBooleanClick, {title:LANG.sa_obas_l, modes:SLA}),

            // SLA
            slaOutput:           UC.newGroup(LANG.sa_layr_m, null, {modes:SLA, group:"sla-layers"}),
            slaLayerOn:          UC.newInput(LANG.sa_lton_s, {title:LANG.sa_lton_l, convert:UC.toFloat, modes:SLA}),
            slaLayerOff:         UC.newInput(LANG.sa_ltof_s, {title:LANG.sa_ltof_l, convert:UC.toFloat, modes:SLA, expert:true}),
            slaPeelDist:         UC.newInput(LANG.sa_pldi_s, {title:LANG.sa_pldi_l, convert:UC.toFloat, modes:SLA}),
            slaPeelLiftRate:     UC.newInput(LANG.sa_pllr_s, {title:LANG.sa_pllr_l, convert:UC.toFloat, modes:SLA, expert:true}),
            slaPeelDropRate:     UC.newInput(LANG.sa_pldr_s, {title:LANG.sa_pldr_l, convert:UC.toFloat, modes:SLA, expert:true}),

            slaOutput:           UC.newGroup(LANG.sa_base_m, null, {modes:SLA, group:"sla-base"}),
            slaBaseLayers:       UC.newInput(LANG.sa_balc_s, {title:LANG.sa_balc_l, convert:UC.toInt, modes:SLA}),
            slaBaseOn:           UC.newInput(LANG.sa_lton_s, {title:LANG.sa_bltn_l, convert:UC.toFloat, modes:SLA}),
            slaBaseOff:          UC.newInput(LANG.sa_ltof_s, {title:LANG.sa_bltf_l, convert:UC.toFloat, modes:SLA, expert:true}),
            slaBasePeelDist:     UC.newInput(LANG.sa_pldi_s, {title:LANG.sa_pldi_l, convert:UC.toFloat, modes:SLA}),
            slaBasePeelLiftRate: UC.newInput(LANG.sa_pllr_s, {title:LANG.sa_pllr_l, convert:UC.toFloat, modes:SLA, expert:true}),

            slaFill:             UC.newGroup(LANG.sa_infl_m, null, {modes:SLA, group:"sla-infill"}),
            slaFillDensity:      UC.newInput(LANG.sa_ifdn_s, {title:LANG.sa_ifdn_l, convert:UC.toFloat, bound:UC.bound(0,1), modes:SLA}),
            slaFillLine:         UC.newInput(LANG.sa_iflw_s, {title:LANG.sa_iflw_l, convert:UC.toFloat, bound:UC.bound(0,5), modes:SLA}),

            slaSupport:          UC.newGroup(LANG.sa_supp_m, null, {modes:SLA, group:"sla-support"}),
            slaSupportLayers:    UC.newInput(LANG.sa_slyr_s, {title:LANG.sa_slyr_l, convert:UC.toInt, bound:UC.bound(5,100), modes:SLA}),
            slaSupportGap:       UC.newInput(LANG.sa_slgp_s, {title:LANG.sa_slgp_l, convert:UC.toInt, bound:UC.bound(3,30), modes:SLA, expert:true}),
            slaSupportDensity:   UC.newInput(LANG.sa_sldn_s, {title:LANG.sa_sldn_l, convert:UC.toFloat, bound:UC.bound(0.01,0.9), modes:SLA}),
            slaSupportSize:      UC.newInput(LANG.sa_slsz_s, {title:LANG.sa_slsz_l, convert:UC.toFloat, bound:UC.bound(0.1,1), modes:SLA}),
            slaSupportPoints:    UC.newInput(LANG.sa_slpt_s, {title:LANG.sa_slpt_l, convert:UC.toInt, bound:UC.bound(3,10), modes:SLA, expert:true}),
            slaSupportEnable:    UC.newBoolean(LANG.enable, onBooleanClick, {title:LANG.sl_slen_l, modes:SLA}),

            slaOutput:           UC.newGroup(LANG.sa_outp_m, null, {modes:SLA, group:"sla-first"}),
            slaFirstOffset:      UC.newInput(LANG.sa_opzo_s, {title:LANG.sa_opzo_l, convert:UC.toFloat, bound:UC.bound(0,1), modes:SLA, expert:true}),
            slaAntiAlias:        UC.newSelect(LANG.sa_opaa_s, {title:LANG.sa_opaa_l, modes:SLA}, "antialias"),

            settingsGroup: UC.newGroup(LANG.se_menu, $('settings')),
            settingsTable: UC.newTableRow([
                [
                    UI.settingsLoad =
                    UC.newButton(LANG.se_load, settingsLoad),
                    UI.settingsSave =
                    UC.newButton(LANG.se_save, settingsSave)
                ]
            ]),

            layers:        UC.setGroup($("layers")),
        });

        function spindleShow() {
            return settings().device.spindleMax > 0;
        }

        // slider setup
        const slbar = 30;
        const slbar2 = slbar * 2;
        const slider = UI.sliderRange;
        const drag = { };

        function pxToInt(txt) {
            return txt ? parseInt(txt.substring(0,txt.length-2)) : 0;
        }

        function sliderUpdate() {
            let start = drag.low / drag.maxval;
            let end = (drag.low + drag.mid - slbar) / drag.maxval;
            API.event.emit('slider.pos', { start, end });
            API.var.layer_lo = Math.round(start * API.var.layer_max);
            API.var.layer_hi = Math.round(end * API.var.layer_max);
            API.show.layer();
            SPACE.scene.active();
        }

        function dragit(el, delta) {
            el.onmousedown = (ev) => {
                tracker.style.display = 'block';
                ev.stopPropagation();
                drag.width = slider.clientWidth;
                drag.maxval = drag.width - slbar2;
                drag.start = ev.screenX;
                drag.loat = drag.low = pxToInt(UI.sliderHold.style.marginLeft);
                drag.mdat = drag.mid = UI.sliderMid.clientWidth;
                drag.hiat = pxToInt(UI.sliderHold.style.marginRight);
                drag.mdmax = drag.width - slbar - drag.loat;
                drag.himax = drag.width - slbar - drag.mdat;
                let cancel_drag = tracker.onmouseup = (ev) => {
                    if (ev) {
                        ev.stopPropagation();
                        ev.preventDefault();
                    }
                    slider.onmousemove = undefined;
                    tracker.style.display = 'none';
                };
                tracker.onmousemove = (ev) => {
                    ev.stopPropagation();
                    ev.preventDefault();
                    if (ev.buttons === 0) {
                        return cancel_drag();
                    }
                    if (delta) delta(ev.screenX - drag.start);
                };
            };
        }

        dragit(UI.sliderLo, (delta) => {
            let midval = drag.mdat - delta;
            let lowval = drag.loat + delta;
            if (midval < slbar || lowval < 0) {
                return;
            }
            UI.sliderHold.style.marginLeft = `${lowval}px`;
            UI.sliderMid.style.width = `${midval}px`;
            drag.low = lowval;
            drag.mid = midval;
            sliderUpdate();
        });
        dragit(UI.sliderMid, (delta) => {
            let loval = drag.loat + delta;
            let hival = drag.hiat - delta;
            if (loval < 0 || hival < 0) return;
            UI.sliderHold.style.marginLeft = `${loval}px`;
            UI.sliderHold.style.marginRight = `${hival}px`;
            drag.low = loval;
            sliderUpdate();
        });
        dragit(UI.sliderHi, (delta) => {
            let midval = drag.mdat + delta;
            let hival = drag.hiat - delta;
            if (midval < slbar || midval > drag.mdmax || hival < 0) return;
            UI.sliderMid.style.width = `${midval}px`;
            UI.sliderHold.style.marginRight = `${hival}px`;
            drag.mid = midval;
            sliderUpdate();
        });

        UI.sliderMin.onclick = () => {
            API.show.layer(0,0);
        }

        UI.sliderMax.onclick = () => {
            API.show.layer(API.var.layer_max,0);
        }

        UI.slider.onmouseover = (ev) => {
            API.event.emit('slider.label');
        };

        UI.slider.onmouseleave = (ev) => {
            if (!ev.buttons) API.event.emit('slider.unlabel');
        };

        API.event.on('slider.unlabel', (values) => {
        });

        API.event.on('slider.label', (values) => {
            let digits = API.var.layer_max.toString().length;
            $('slider-zero').style.width = `${digits}em`;
            $('slider-max').style.width = `${digits}em`;
            $('slider-zero').innerText = API.var.layer_lo;
            $('slider-max').innerText = API.var.layer_hi;
        });

        API.event.on('slider.set', (values) => {
            let width = slider.clientWidth;
            let maxval = width - slbar2;
            let start = Math.max(0, Math.min(1, values.start));
            let end = Math.max(start, Math.min(1, values.end));
            let lowval = start * maxval;
            let midval = ((end - start) * maxval) + slbar;
            let hival = maxval - end * maxval;
            UI.sliderHold.style.marginLeft = `${lowval}px`;
            UI.sliderMid.style.width = `${midval}px`;
            UI.sliderHold.style.marginRight = `${hival}px`;
        });

        // bind language choices
        $('lset-en').onclick = function() {
            SDB.setItem('kiri-lang', 'en-us');
            API.space.reload();
        };
        // $('lset-da').onclick = function() {
        //     SDB.setItem('kiri-lang', 'da-dk');
        //     API.space.reload();
        // };

        SPACE.addEventHandlers(self, [
            'keyup', keyUpHandler,
            'keydown', keyDownHandler,
            'keypress', keyHandler,
            'dragover', dragOverHandler,
            'dragleave', dragLeave,
            'drop', dropHandler
        ]);

        function selectionSize(e) {
            let dv = parseFloat(e.target.value || 1),
                pv = parseFloat(e.target.was || 1),
                ra = dv / pv,
                xv = parseFloat(UI.sizeX.was),
                yv = parseFloat(UI.sizeY.was),
                zv = parseFloat(UI.sizeZ.was),
                xr = (UI.lockX.checked ? ra : 1),
                yr = (UI.lockY.checked ? ra : 1),
                zr = (UI.lockZ.checked ? ra : 1);
            API.selection.scale(xr,yr,zr);
            UI.sizeX.was = UI.sizeX.value = xv * xr;
            UI.sizeY.was = UI.sizeY.value = yv * yr;
            UI.sizeZ.was = UI.sizeZ.value = zv * zr;
        }

        function selectionScale(e) {
            let dv = parseFloat(e.target.value || 1),
                pv = parseFloat(e.target.was || 1),
                ra = dv / pv,
                xv = parseFloat(UI.scaleX.was),
                yv = parseFloat(UI.scaleY.was),
                zv = parseFloat(UI.scaleZ.was),
                xr = (UI.lockX.checked ? ra : 1),
                yr = (UI.lockY.checked ? ra : 1),
                zr = (UI.lockZ.checked ? ra : 1);
            API.selection.scale(xr,yr,zr);
            UI.scaleX.was = UI.scaleX.value = xv * xr;
            UI.scaleY.was = UI.scaleY.value = yv * yr;
            UI.scaleZ.was = UI.scaleZ.value = zv * zr;
        }

        function selectionRotate(e) {
            let deg = parseFloat(e.target.value) * DEG;
            e.target.value = 0;
            switch (e.target.id.split('').pop()) {
                case 'x': return API.selection.rotate(deg,0,0);
                case 'y': return API.selection.rotate(0,deg,0);
                case 'z': return API.selection.rotate(0,0,deg);
            }
        }

        SPACE.onEnterKey([
            // UI.layerSpan,     function() { API.show.slices() },
            // UI.layerID,       function() { API.show.layer(UI.layerID.value) },
            UI.scaleX,        selectionScale,
            UI.scaleY,        selectionScale,
            UI.scaleZ,        selectionScale,
            UI.sizeX,         selectionSize,
            UI.sizeY,         selectionSize,
            UI.sizeZ,         selectionSize,
            UI.toolName,      updateTool,
            UI.toolNum,       updateTool,
            UI.toolFluteDiam, updateTool,
            UI.toolFluteLen,  updateTool,
            UI.toolShaftDiam, updateTool,
            UI.toolShaftLen,  updateTool,
            UI.toolTaperTip,  updateTool,
            $('rot_x'),       selectionRotate,
            $('rot_y'),       selectionRotate,
            $('rot_z'),       selectionRotate
        ]);

        UI.toolMetric.onclick = updateTool;
        UI.toolType.onchange = updateTool;

        function mksvg(src) {
            let svg = DOC.createElement('svg');
            svg.innerHTML = src;
            return svg;
        }

        function mklbl(src) {
            let lbl = DOC.createElement('label');
            lbl.innerText = src;
            return lbl;
        }

        $('mode-fdm').appendChild(mksvg(icons.fdm));
        $('mode-sla').appendChild(mksvg(icons.sla));
        $('mode-cam').appendChild(mksvg(icons.cnc));
        $('mode-laser').appendChild(mksvg(icons.laser));

        API.platform.update_size();

        SPACE.mouse.onHover((int, event, ints) => {
            if (!API.feature.hover) return;
            if (!int) return API.widgets.meshes();
            API.event.emit('mouse.hover', {int, event, point: int.point, type: 'widget'});
        });

        SPACE.platform.onHover((int, event) => {
            if (!API.feature.hover) return;
            if (int) API.event.emit('mouse.hover', {point: int, event, type: 'platform'});
        });

        SPACE.mouse.up((event, int) => {
            if (event.button === 2 && API.view.isArrange()) {
                let style = UI.context.style;
                style.display = 'flex';
                style.left = `${event.clientX-3}px`;
                style.top = `${event.clientY-3}px`;
                UI.context.onmouseleave = () => {
                    style.display = '';
                };
            }
        });

        SPACE.mouse.downSelect((int,event) => {
            if (API.feature.hover) {
                if (int) {
                    API.event.emit('mouse.hover.down', {int, point: int.point});
                    return;
                }
                return;
            }
            // lay flat with meta or ctrl clicking a selected face
            if (int && (event.ctrlKey || event.metaKey || API.feature.on_face_select)) {
                let q = new THREE.Quaternion();
                // find intersecting point, look "up" on Z and rotate to face that
                q.setFromUnitVectors(int.face.normal, new THREE.Vector3(0,0,-1));
                API.selection.rotate(q);
            }
            if (API.view.get() !== VIEWS.ARRANGE) {
                // return no selection in modes other than arrange
                return null;
            } else {
                // return selected meshes for further mouse processing
                return API.selection.meshes();
            }
        });

        SPACE.mouse.upSelect(function(selection, event) {
            if (event && API.feature.hover) {
                API.event.emit('mouse.hover.up', selection);
                return;
            }
            if (event && event.target.nodeName === "CANVAS") {
                if (selection) {
                    if (selection.object.widget) {
                        platform.select(selection.object.widget, event.shiftKey);
                    }
                } else {
                    platform.deselect();
                }
            } else {
                return API.widgets.meshes();
            }
        });

        SPACE.mouse.onDrag(function(delta) {
            if (API.feature.hover) {
                return;
            }
            if (delta && UI.freeLayout.checked) {
                let set = settings();
                let dev = set.device;
                let bound = set.bounds_sel;
                let width = dev.bedWidth/2;
                let depth = dev.bedDepth/2;
                let isout = (
                    bound.min.x <= -width ||
                    bound.min.y <= -depth ||
                    bound.max.x >= width ||
                    bound.max.y >= depth
                );
                if (!isout) {
                    if (bound.min.x + delta.x <= -width) return;
                    if (bound.min.y + delta.y <= -depth) return;
                    if (bound.max.x + delta.x >= width) return;
                    if (bound.max.y + delta.y >= depth) return;
                }
                API.selection.move(delta.x, delta.y, 0);
                API.event.emit('selection.drag', delta);
            } else {
                return API.selection.meshes().length > 0;
            }
        });

        API.space.restore(init_two) || checkSeed(init_two) || init_two();

    };

    // SECOND STAGE INIT AFTER UI RESTORED

    function init_two() {
        API.event.emit('init.two');

        // call driver initializations, if present
        Object.values(KIRI.driver).forEach(driver => {
            if (driver.init) try {
                driver.init(KIRI, API);
            } catch (error) {
                console.log({driver_init_fail: driver, error})
            }
        });

        // load script extensions
        if (SETUP.s) SETUP.s.forEach(function(lib) {
            let scr = DOC.createElement('script');
            scr.setAttribute('defer',true);
            scr.setAttribute('src',`/code/${lib}.js?${KIRI.version}`);
            DOC.body.appendChild(scr);
            STATS.add('load_'+lib);
            API.event.emit('load.lib', lib);
        });

        // load CSS extensions
        if (SETUP.ss) SETUP.ss.forEach(function(style) {
            style = style.charAt(0) === '/' ? style : `/kiri/style-${style}`;
            let ss = DOC.createElement('link');
            ss.setAttribute("type", "text/css");
            ss.setAttribute("rel", "stylesheet");
            ss.setAttribute("href", `${style}.css?${KIRI.version}`);
            DOC.body.appendChild(ss);
        });

        // override stored settings
        if (SETUP.v) SETUP.v.forEach(function(kv) {
            kv = kv.split('=');
            SDB.setItem(kv[0],kv[1]);
        });

        // import octoprint settings
        if (SETUP.ophost) {
            let ohost = API.const.OCTO = {
                host: SETUP.ophost[0],
                apik: SETUP.opkey ? SETUP.opkey[0] : ''
            };
            SDB['octo-host'] = ohost.host;
            SDB['octo-apik'] = ohost.apik;
            console.log({octoprint:ohost});
        }

        // bind this to UI so main can call it on settings import
        UI.sync = function() {
            const current = settings();
            const control = current.controller;
            const process = settings.process;

            platform.deselect();
            CATALOG.addFileListener(updateCatalog);
            SPACE.view.setZoom(control.reverseZoom, control.zoomSpeed);
            SPACE.platform.setZOff(0.2);

            // restore UI state from settings
            UI.showOrigin.checked = control.showOrigin;
            UI.showRulers.checked = control.showRulers;
            UI.showSpeeds.checked = control.showSpeeds;
            UI.freeLayout.checked = control.freeLayout;
            UI.autoLayout.checked = control.autoLayout;
            UI.alignTop.checked = control.alignTop;
            UI.reverseZoom.checked = control.reverseZoom;
            UI.autoSave.checked = control.autoSave;
            UI.decimate.checked = control.decimate;
            lineTypeSave();
            detailSave();
            updateFPS();

            // optional set-and-lock mode (hides mode menu)
            let SETMODE = SETUP.mode ? SETUP.mode[0] : null;

            // optional set-and-lock device (hides device menu)
            let DEVNAME = SETUP.dev ? SETUP.dev[0] : null;

            // setup default mode and enable mode locking, if set
            API.mode.set(SETMODE || STARTMODE || current.mode, SETMODE);

            // restore expert setting preference
            API.mode.set_expert(control.expert);

            // fill device list
            updateDeviceList();

            // ensure settings has gcode
            selectDevice(DEVNAME || API.device.get(), DEVNAME);

            // update ui fields from settings
            API.view.update_fields();

            // default to ARRANGE view mode
            API.view.set(VIEWS.ARRANGE);

            // add ability to override
            API.show.controls(API.feature.controls);

            // update everything dependent on the platform size
            platform.update_size();
        };

        UI.sync();

        // load settings provided in url hash
        loadSettingsFromServer();

        // clear alerts as they build up
        setInterval(API.event.alerts, 1000);

        // add hide-alerts-on-alert-click
        UI.alert.dialog.onclick = function() {
            API.event.alerts(true);
        };

        // enable modal hiding
        $('mod-x').onclick = API.modal.hide;

        if (!SETUP.s) console.log(`kiri | init main | ${KIRI.version}`);

        // send init-done event
        API.event.emit('init-done', STATS);

        // show gdpr if it's never been seen and we're not iframed
        if (!SDB.gdpr && WIN.self === WIN.top) {
            $('gdpr').style.display = 'flex';
        }

        // add keyboard focus handler (must use for iframes)
        WIN.addEventListener('load', function () {
            WIN.focus();
            DOC.body.addEventListener('click', function() {
                WIN.focus();
            },false);
        });

        // dismiss gdpr alert
        $('gotit').onclick = () => {
            $('gdpr').style.display = 'none';
            SDB.gdpr = Date.now();
        };

        // lift curtain
        $('curtain').style.display = 'none';

        function showSetup() {
            API.modal.show('setup');
        }

        // bind interface action elements
        $('app-name').onclick = API.help.show;
        $('app-mode').onclick = (ev) => { ev.stopPropagation(); showSetup() };
        $('set-device').onclick = (ev) => { ev.stopPropagation(); showSetup() };
        $('set-tools').onclick = (ev) => { ev.stopPropagation(); showTools() };
        $('set-prefs').onclick = (ev) => { ev.stopPropagation(); API.modal.show('prefs') };
        UI.acct.help.onclick = (ev) => { ev.stopPropagation(); API.help.show() };
        UI.acct.export.onclick = (ev) => { ev.stopPropagation(); profileExport() };
        UI.acct.export.title = LANG.acct_xpo;
        $('file-recent').onclick = () => { API.modal.show('files') };
        $('file-import').onclick = () => { API.event.import() };
        UI.back.onclick = API.platform.layout;
        UI.trash.onclick = API.selection.delete;
        UI.func.slice.onclick = (ev) => { ev.stopPropagation(); API.function.slice() };
        UI.func.preview.onclick = (ev) => { ev.stopPropagation(); API.function.print() };
        UI.func.animate.onclick = (ev) => { ev.stopPropagation(); API.function.animate() };
        UI.func.export.onclick = (ev) => { ev.stopPropagation(); API.function.export() };
        $('view-arrange').onclick = API.platform.layout;
        $('view-top').onclick = SPACE.view.top;
        $('view-home').onclick = SPACE.view.home;
        $('view-clear').onclick = API.platform.clear;
        $('mode-fdm').onclick = () => { API.mode.set('FDM') };
        $('mode-sla').onclick = () => { API.mode.set('SLA') };
        $('mode-cam').onclick = () => { API.mode.set('CAM') };
        $('mode-laser').onclick = () => { API.mode.set('LASER') };
        $('unrotate').onclick = () => { API.widgets.for(w => w.unrotate()) };
        // rotation buttons
        let d = (Math.PI / 180) * 5;
        $('rot_x_lt').onclick = () => { API.selection.rotate(-d,0,0) };
        $('rot_x_gt').onclick = () => { API.selection.rotate( d,0,0) };
        $('rot_y_lt').onclick = () => { API.selection.rotate(0,-d,0) };
        $('rot_y_gt').onclick = () => { API.selection.rotate(0, d,0) };
        $('rot_z_lt').onclick = () => { API.selection.rotate(0,0, d) };
        $('rot_z_gt').onclick = () => { API.selection.rotate(0,0,-d) };
        // rendering options
        $('render-hide').onclick = () => { API.view.wireframe(false, 0, 0); };
        $('render-ghost').onclick = () => { API.view.wireframe(false, 0, 0.5); };
        $('render-wire').onclick = () => { API.view.wireframe(true, 0, 0.5); };
        $('render-solid').onclick = () => { API.view.wireframe(false, 0, 1); };
        // context menu
        $('context-export-stl').onclick = () => { objectsExport() };
        $('context-export-workspace').onclick = () => { profileExport(true) };
        $('context-clear-workspace').onclick = () => { API.platform.clear(); UI.context.onmouseleave() };

        UI.modal.onclick = API.modal.hide;
        UI.modalBox.onclick = (ev) => { ev.stopPropagation() };

        // add app name hover info
        $('app-info').innerText = KIRI.version;
        // show topline separator when iframed
        // try { if (WIN.self !== WIN.top) $('top-sep').style.display = 'flex' } catch (e) { }

        // warn users they are running a beta release
        if (KIRI.beta && KIRI.beta > 0 && SDB.kiri_beta != KIRI.beta) {
            API.show.alert("this is a beta / development release");
            SDB.kiri_beta = KIRI.beta;
        }
    }

    // if a language needs to load, the script is injected and loaded
    // first.  once this loads, or doesn't, the initialization begins
    let lang_set = undefined;
    let lang = SETUP.ln ? SETUP.ln[0] : SDB.getItem('kiri-lang') || KIRI.lang.get();

    // inject language script if not english
    if (lang && lang !== 'en' && lang !== 'en-us') {
        lang_set = lang;
        let scr = DOC.createElement('script');
        // scr.setAttribute('defer',true);
        scr.setAttribute('src',`/kiri/lang/${lang}.js`);
        (DOC.body || DOC.head).appendChild(scr);
        STATS.set('ll',lang);
        scr.onload = function() {
            KIRI.lang.set(lang);
            init_one();
        };
        scr.onerror = function(err) {
            console.log({language_load_error: err, lang})
            init_one();
        }
    }

    // set to browser default which will be overridden
    // by any future script loads (above)
    KIRI.lang.set();

    // schedule init_one to run after all page content is loaded
    // unless a languge script is loading first, in which case it
    // will call init once it's done (or failed)
    if (!lang_set) {
        if (document.readyState === 'loading') {
            SPACE.addEventListener(DOC, 'DOMContentLoaded', init_one);
        } else {
            // happens in debug mode when scripts are chain loaded
            init_one();
        }
    }

})();
