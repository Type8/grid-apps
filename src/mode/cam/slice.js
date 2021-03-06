/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

"use strict";

(function() {

    let KIRI = self.kiri,
        BASE = self.base,
        UTIL = BASE.util,
        CAM = KIRI.driver.CAM,
        PRO = CAM.process,
        POLY = BASE.polygons,
        newSlice = KIRI.newSlice,
        newPoint = BASE.newPoint,
        newPolygon = BASE.newPolygon;

    /**
     * DRIVER SLICE CONTRACT
     *
     * @param {Object} settings
     * @param {Widget} widget
     * @param {Function} output
     */
    CAM.slice = function(settings, widget, onupdate, ondone) {
        
        let conf = settings,
            proc = conf.process,
            stock = settings.stock || {},
            hasStock = stock.x && stock.y && stock.z && proc.camStockOn,
            sliceAll = widget.slices = [],
            unitsName = settings.controller.units,
            roughTool = new CAM.Tool(conf, proc.camRoughTool),
            roughToolDiam = roughTool.fluteDiameter(),
            drillTool = new CAM.Tool(conf, proc.camDrillTool),
            drillToolDiam = drillTool.fluteDiameter(),
            procFacing = proc.camRoughOn && proc.camZTopOffset && hasStock,
            procRough = proc.camRoughOn && proc.camRoughDown,
            procRoughIn = proc.camRoughIn,
            procOutlineWide = proc.camOutlineWide,
            procOutlineOut = proc.camOutlineOut,
            procOutlineIn = proc.camOutlineIn,
            procOutlineOn = proc.camOutlineOn,
            procOutline = procOutlineOn && proc.camOutlineDown,
            procContourX = proc.camContourXOn && proc.camOutlinePlunge,
            procContourY = proc.camContourYOn && proc.camOutlinePlunge,
            procContour = procContourX || procContourY,
            procDrill = proc.camDrillingOn && proc.camDrillDown && proc.camDrillDownSpeed,
            procDrillReg = proc.camDrillReg,
            roughDown = procRough ? proc.camRoughDown : Infinity,
            outlineDown = procOutline ? proc.camOutlineDown : Infinity,
            sliceDepth = Math.max(0.1, Math.min(roughDown, outlineDown) / 3),
            bounds = widget.getBoundingBox(),
            mesh = widget.mesh,
            zBottom = proc.camZBottom,
            zMin = Math.max(bounds.min.z, zBottom),
            zMax = bounds.max.z,
            zThru = zBottom === 0 ? (proc.camZThru || 0) : 0,
            ztOff = hasStock ? proc.camZTopOffset : 0,
            camRoughStock = proc.camRoughStock,
            camRoughDown = proc.camRoughDown,
            minStepDown = Math.min(1, roughDown/3, outlineDown/3),
            minToolDiam = Infinity,
            maxToolDiam = -Infinity,
            thruHoles,
            tabs = settings.widget[widget.id].tab;

        if (tabs) {
            // make tab polygons
            tabs.forEach(tab => {
                let zero = newPoint(0,0,0);
                let point = newPoint(tab.pos.x, tab.pos.y, tab.pos.z);
                let poly = newPolygon().centerRectangle(zero, tab.dim.x, tab.dim.y);
                let tslice = newSlice(0);
                let m4 = new THREE.Matrix4().makeRotationFromQuaternion(
                    new THREE.Quaternion(tab.rot._x, tab.rot._y, tab.rot._z, tab.rot._w)
                );
                poly.points = poly.points
                    .map(p => new THREE.Vector3(p.x,p.y,p.z).applyMatrix4(m4))
                    .map(v => newPoint(v.x, v.y, v.z));
                poly.move(point);
                tab.poly = poly;
                // tslice.output().setLayer("tabs", 0xff0000).addPoly(poly);
                // sliceAll.push(tslice);
            });
        }

        if (stock.x && stock.y && stock.z) {
            if (stock.x + 0.00001 < bounds.max.x - bounds.min.x) {
                return ondone('stock X too small for part. disable stock or use offset stock');
            }

            if (stock.y + 0.00001 < bounds.max.y - bounds.min.y) {
                return ondone('stock Y too small for part. disable stock or use offset stock');
            }

            if (stock.z + 0.00001 < bounds.max.z - bounds.min.z) {
                return ondone('stock Z too small for part. disable stock or use offset stock');
            }
        }

        if (sliceDepth <= 0.05) {
            return ondone(`invalid slice depth (${sliceDepth.toFixed(2)} ${unitsName})`);
        }

        if (!(procFacing || procRough || procOutline || procContour || procDrill || procDrillReg)) {
            return ondone("no processes selected");
        }

        if (zMin >= bounds.max.z) {
            return ondone(`invalid z bottom >= bounds z max ${bounds.max.z}`);
        }

        // allows progress output to me weighted and matched to processes
        let ops = [ [ "mapping", 1.5 ] ];
        if (procRough) ops.push([ "roughing", 1 ]);
        if (procRough) ops.push([ "rough offset", 1 ]);
        if (procOutline) ops.push([ "outline", 0.5 ]);
        if (procContour) ops.push([ "contour", 4 ]);
        let opsTot = ops.map(op => op[1]).reduce((a,v) => a + v);
        let opSum = 0;
        let opTot;
        let opOn;

        function nextOp() {
            if (opOn) opSum += opOn[1];
            opOn = ops.shift();
            opTot = opOn[1] / opsTot;
        }

        function updateOp(index, total, msg) {
            onupdate((opSum/opsTot) + (index/total) * opTot, msg || opOn[0]);
        }

        function updateToolDiams(toolDiam) {
            minToolDiam = Math.min(minToolDiam, toolDiam);
            maxToolDiam = Math.max(maxToolDiam, toolDiam);
        }

        let mark = Date.now();
        let slicer = new KIRI.slicer2(widget.getPoints(), {
            zlist: true,
            zline: true
        });

        // xray debug
        if (false) {
            console.log({slicer_setup: Date.now() - mark});
            let xlicer = new KIRI.slicer2(widget.getPoints(), {
                zlist: true,
                zline: true
            });
            let xrayind = Object.keys(xlicer.zLine)
                .map(v => parseFloat(v).round(5))
                .sort((a,b) => a-b);
            let xrayopt = { each: (data, index, total) => {
                let slice = newSlice(data.z);
                slice.addTops(data.tops);
                // data.tops.forEach(top => slice.addTop(top));
                slice.lines = data.lines;
                slice.xray();
                sliceAll.push(slice);
            }, over: false, flatoff: 0, edges: true, openok: true };
            xlicer.slice(xrayind, xrayopt);
            // xrayopt.over = true;
            // slicer.slice(xrayind, xrayopt);
        }

        nextOp();
        let tslices = [];
        let tshadow = [];
        let tzindex = slicer.interval(minStepDown, { fit: true, off: 0.01, down: true, flats: true });
        let skipTerrain = !(procRough || procOutline) && tzindex.length > 50;

        if (skipTerrain) {
            console.log("skipping terrain generation for speed");
            tzindex = [ tzindex.pop() ];
        }

        let terrain = slicer.slice(tzindex, { each: (data, index, total) => {
            tshadow = POLY.union(tshadow.slice().appendAll(data.tops), 0.01, true);
            tslices.push(data.slice);
            if (false) {
                const slice = data.slice;
                sliceAll.push(slice);
                slice.output()
                    .setLayer("terrain", {line: 0x888800, thin: true })
                    .addPolys(POLY.setZ(tshadow.clone(true), data.z), { thin: true });
            }
            updateOp(index, total);
        }, genso: true });

        let shadowTop = terrain[terrain.length - 1];
        let center = tshadow[0].bounds.center();

        if (procDrillReg) {
            updateToolDiams(drillToolDiam);
            sliceDrillReg(settings, sliceAll, zThru);
        }

        // identify through holes
        thruHoles = tshadow.map(p => p.inner || []).flat();

        // create facing slices
        if (procFacing || proc.camRoughTop) {
            let shadow = tshadow.clone();
            let inset = POLY.offset(shadow, (roughToolDiam / (procRoughIn ? 2 : 1)));
            let facing = POLY.offset(inset, -(roughToolDiam * proc.camRoughOver), { count: 999, flat: true });
            let zdiv = ztOff / roughDown;
            let zstep = (zdiv % 1 > 0) ? ztOff / (Math.floor(zdiv) + 1) : roughDown;
            if (proc.camRoughTop && ztOff === 0) {
                // compensate for lack of z top offset in this scenario
                ztOff = zstep;
            }
            for (let z = zMax + ztOff - zstep; z >= zMax; z -= zstep) {
                let slice = shadowTop.slice.clone(false);
                slice.z = z;
                slice.camMode = PRO.LEVEL;
                slice.camLines = POLY.setZ(facing.clone(true), slice.z);
                slice.output()
                    .setLayer("facing", {face: 0, line: 0})
                    .addPolys(slice.camLines);
                sliceAll.push(slice);
            }
        }

        // create roughing slices
        if (procRough) {
            nextOp();
            updateToolDiams(roughToolDiam);

            let flats = [];
            let shadow = [];
            let slices = [];
            let indices = slicer.interval(roughDown, { down: true, min: zBottom, fit: true, off: 0.01 });
            // shift out first (top-most) slice
            indices.shift();
            if (proc.camRoughFlat) {
                let flats = Object.keys(slicer.zFlat)
                    .map(v => parseFloat(v).round(4))
                    .filter(v => v >= zBottom);
                flats.forEach(v => {
                    if (!indices.contains(v)) {
                        indices.push(v);
                    }
                });
                indices = indices.sort((a,b) => { return b - a });
                // if layer is not on a flat and next one is,
                // then move this layer up to mid-point to previous layer
                // this is not perfect. the best method is to interpolate
                // between flats so that each step is < step down. on todo list
                for (let i=1; i<indices.length-1; i++) {
                    const prev = indices[i-1];
                    const curr = indices[i];
                    const next = indices[i+1];
                    if (!flats.contains(curr) && flats.contains(next)) {
                        // console.log('move',curr,'up toward',prev,'b/c next',next,'is flat');
                        indices[i] = next + ((prev - next) / 2);
                    }
                }
            } else {
                // add flats to shadow
                flats = Object.keys(slicer.zFlat)
                    .map(v => (parseFloat(v) - 0.01).round(5))
                    .filter(v => v > 0 && indices.indexOf(v) < 0);
                indices = indices.appendAll(flats).sort((a,b) => b-a);
            }

            // console.log('indices', ...indices, {zBottom});
            slicer.slice(indices, { each: (data, index, total) => {
                shadow = POLY.union(shadow.slice().appendAll(data.tops), 0.01, true);
                if (flats.indexOf(data.z) >= 0) {
                    // exclude flats injected to complete shadow
                    return;
                }
                data.shadow = shadow.clone(true);
                data.slice.camMode = PRO.ROUGH;
                data.slice.shadow = data.shadow;
                // data.slice.tops[0].inner = data.shadow;
                // data.slice.tops[0].inner = POLY.setZ(tshadow.clone(true), data.z);
                slices.push(data.slice);
                updateOp(index, total);
            }, genso: true });

            shadow = POLY.union(shadow.appendAll(shadowTop.tops), 0.01, true);

            // inset or eliminate thru holes from shadow
            shadow = POLY.flatten(shadow.clone(true), [], true);
            thruHoles.forEach(hole => {
                shadow = shadow.map(p => {
                    if (p.isEquivalent(hole)) {
                        // eliminate thru holes when roughing voids enabled
                        if (proc.camRoughVoid) {
                            return undefined;
                        }
                        // let po = POLY.offset([p], -(roughToolDiam + camRoughStock));
                        let po = POLY.offset([p], -(roughToolDiam / 2 + camRoughStock + 0.001));
                        return po ? po[0] : undefined;
                    } else {
                        return p;
                    }
                }).filter(p => p);
            });
            shadow = POLY.nest(shadow);

            // expand shadow by half tool diameter + stock to leave
            // const sadd = procRoughIn ? roughToolDiam / 4 : roughToolDiam / 2;
            const sadd = procRoughIn ? roughToolDiam / 2 : roughToolDiam / 2;
            const shell = POLY.offset(shadow, sadd + camRoughStock);

            nextOp();
            slices.forEach((slice, index) => {
                let offset = [shell.clone(true),slice.shadow.clone(true)].flat();
                let flat = POLY.flatten(offset, [], true);
                let nest = POLY.setZ(POLY.nest(flat), slice.z);

                // inset offset array by 1/2 diameter then by tool overlap %
                offset = POLY.offset(nest, [-(roughToolDiam / 2 + camRoughStock), -roughToolDiam * proc.camRoughOver], {
                    minArea: 0,
                    z: slice.z,
                    count: 999,
                    flat: true,
                    call: (polys, count, depth) => {
                        // used in depth-first path creation
                        polys.forEach(p => {
                            p.depth = depth;
                            if (p.inner) {
                                p.inner.forEach(p => p.depth = depth);
                            }
                        });
                    }
                }) || [];

                // add outside pass if not inside only
                if (!procRoughIn) {
                    const outside = POLY.offset(shadow.clone(), roughToolDiam * proc.camRoughOver, {z: slice.z});
                    if (outside) {
                        offset.appendAll(outside);
                    }
                }

                if (tabs) {
                    tabs.forEach(tab => {
                        tab.off = POLY.expand([tab.poly], roughToolDiam / 2).flat();
                    });
                    offset = cutTabs(tabs, offset, slice.z);
                }

                if (!offset) return;

                // elimate double inset on inners
                offset.forEach(op => {
                    if (op.inner) {
                        let operim = op.perimeter();
                        let newinner = [];
                        op.inner.forEach(oi => {
                            if (Math.abs(oi.perimeter() - operim) > 0.01) {
                                newinner.push(oi);
                            }
                        });
                        op.inner = newinner;
                    }
                });

                slice.camLines = offset;
                if (true) slice.output()
                    .setLayer("slice", {line: 0xaaaa00}, true)
                    .addPolys(slice.topPolys())
                    // .setLayer("top shadow", {line: 0x0000aa})
                    // .addPolys(tshadow)
                    // .setLayer("rough shadow", {line: 0x00aa00})
                    // .addPolys(shadow)
                    // .setLayer("rough shell", {line: 0xaa0000})
                    // .addPolys(shell);
                slice.output()
                    .setLayer("roughing", {face: 0, line: 0})
                    .addPolys(offset);
                updateOp(index, slices.length);
            });

            sliceAll.appendAll(slices.filter(slice => slice.camLines));
        }

        // create outline slices
        if (procOutline) {
            nextOp();
            let outlineTool = new CAM.Tool(conf, proc.camOutlineTool);
            let outlineToolDiam = outlineTool.fluteDiameter();
            updateToolDiams(outlineToolDiam);

            let shadow = [];
            let slices = [];
            let indices = slicer.interval(outlineDown, { down: true, min: zBottom, fit: true, off: 0.01 });
            // shift out first (top-most) slice
            indices.shift();
            // add flats to shadow
            const flats = Object.keys(slicer.zFlat)
                .map(v => (parseFloat(v) - 0.01).round(5))
                .filter(v => v > 0 && indices.indexOf(v) < 0);
            indices = indices.appendAll(flats).sort((a,b) => b-a);
            // console.log('indices', ...indices, {zBottom, slicer});
            slicer.slice(indices, { each: (data, index, total) => {
                shadow = POLY.union(shadow.slice().appendAll(data.tops), 0.01, true);
                if (flats.indexOf(data.z) >= 0) {
                    // exclude flats injected to complete shadow
                    return;
                }
                data.shadow = shadow.clone(true);
                data.slice.camMode = PRO.OUTLINE;
                data.slice.shadow = data.shadow;
                // data.slice.tops[0].inner = data.shadow;
                // data.slice.tops[0].inner = POLY.setZ(tshadow.clone(true), data.z);
                slices.push(data.slice);
                // data.slice.xray();
                // onupdate(0.2 + (index/total) * 0.1, "outlines");
                updateOp(index, total);
            }, genso: true });
            shadow = POLY.union(shadow.appendAll(shadowTop.tops), 0.01, true);

            // extend cut thru (only when z bottom is 0)
            if (zThru) {
                let last = slices[slices.length-1];
                let add = last.clone(true);
                add.camMode = last.camMode;
                add.tops.forEach(top => {
                    top.poly.setZ(add.z);
                });
                add.shadow = last.shadow.clone(true);
                add.z -= zThru;
                slices.push(add);
            }

            slices.forEach(slice => {
                let tops = slice.shadow;

                // outside only (use tshadow for entire cut)
                if (procOutlineOut) {
                    tops = tshadow;
                }

                let offset = POLY.expand(tops, outlineToolDiam / 2, slice.z);
                if (!(offset && offset.length)) {
                    return;
                }

                // when pocket only, drop first outer poly
                // if it matches the shell and promote inner polys
                if (procOutlineIn) {
                    let shell = POLY.expand(tops.clone(), outlineToolDiam / 2);
                    offset = POLY.filter(offset, [], function(poly) {
                        if (poly.area() < 1) {
                            return null;
                        }
                        for (let sp=0; sp<shell.length; sp++) {
                            // eliminate shell only polys
                            if (poly.isEquivalent(shell[sp])) {
                                if (poly.inner) return poly.inner;
                                return null;
                            }
                        }
                        return poly;
                    });
                } else {
                    if (procOutlineWide) {
                        offset.slice().forEach(op => {
                            // clone removes inners but the real solution is
                            // to limit expanded shells to through holes
                            POLY.expand([op.clone(true)], outlineToolDiam * 0.5, slice.z, offset, 1);
                        });
                    }
                }

                if (tabs) {
                    tabs.forEach(tab => {
                        tab.off = POLY.expand([tab.poly], outlineToolDiam / 2).flat();
                    });
                    offset = cutTabs(tabs, offset, slice.z);
                }

                if (proc.camOutlineDogbone && !procOutlineWide) {
                    CAM.addDogbones(offset, outlineToolDiam / 5);
                }

                // offset.xout(`slice ${slice.z}`);
                slice.camLines = offset;
                if (false) slice.output()
                    .setLayer("slice", {line: 0xaaaa00}, false)
                    .addPolys(slice.topPolys())
                slice.output()
                    .setLayer("outline", {face: 0, line: 0})
                    .addPolys(offset);
            });

            sliceAll.appendAll(slices);
        }

        // we need topo for safe travel moves when roughing and outlining
        // not generated when drilling-only. then all z moves use bounds max.
        // also generates x and y contouring when selected
        if (procContour) {
            nextOp();
            new CAM.Topo(widget, settings, {
                // onupdate: (update, msg) => {
                onupdate: (index, total, msg) => {
                    updateOp(index, total, msg);
                    // onupdate(0.30 + update * 0.50, msg || "create topo");
                },
                ondone: (slices) => {
                    sliceAll.appendAll(slices);
                },
                shadow: tshadow,
                center: center,
                tabs
            });
        }

        // generate tracing offsets from chosen features
        {
            let proc = settings.process;
            let traces = (settings.widget[widget.id] || {}).trace || [];
            traces.forEach(trace => {
                let { tool, path } = trace;
                let traceTool = new CAM.Tool(settings, tool);
                let traceToolDiam = traceTool.fluteDiameter();
                let slice = newSlice();
                let poly = KIRI.codec.decode(path);
                slice.addTop(poly);
                slice.camMode = PRO.TRACE;
                slice.camLines = [ poly ];
                slice.camTrace = trace;
                if (true) slice.output()
                    .setLayer("trace", {line: 0xaa00aa}, false)
                    .addPolys(slice.topPolys())
                sliceAll.push(slice);
                updateToolDiams(traceToolDiam);
            });
        }

        if (procDrill) {
            updateToolDiams(drillToolDiam);
            sliceDrill(drillTool, tslices, sliceAll);
        }

        sliceAll.forEach((slice, index) => slice.index = index);

        // used in printSetup()
        // used in CAM.prepare.getZClearPath()
        // add tabs to terrain tops so moves avoid them
        if (tabs) {
            terrain.forEach(slab => {
                tabs.forEach(tab => {
                    if (tab.pos.z + tab.dim.z/2 >= slab.z) {
                        let all = [...slab.tops, tab.poly];
                        slab.tops = POLY.union(all, 0, true);
                        // slab.slice.output()
                        //     .setLayer("debug-tabs", {line: 0x880088, thin: true })
                        //     .addPolys(POLY.setZ(slab.tops.clone(true), slab.z), { thin: true });
                    }
                });
            });
        }

        // add shadow perimeter to terrain to catch outside moves off part
        let tabpoly = tabs ? tabs.map(tab => tab.poly) : [];
        let allpoly = POLY.union([...shadowTop.tops, ...tabpoly], 0, true);
        let shadowOff = POLY.offset(allpoly, [minToolDiam/2,maxToolDiam/2], { count: 2, flat: true });
        terrain.forEach(level => level.tops.appendAll(shadowOff));

        // let dslice = KIRI.newSlice(-1);
        // dslice.output().setLayer("shadowOff", { line: 0xff0000 }).addPolys(shadowOff);
        // sliceAll.push(dslice);

        widget.terrain = skipTerrain ? null : terrain;
        widget.minToolDiam = minToolDiam;
        widget.maxToolDiam = maxToolDiam;

        ondone();
    };

    CAM.addDogbones = function(poly, dist, reverse) {
        if (Array.isArray(poly)) {
            return poly.forEach(p => CAM.addDogbones(p, dist));
        }
        let isCW = poly.isClockwise();
        if (reverse || poly.parent) isCW = !isCW;
        let oldpts = poly.points.slice();
        let lastpt = oldpts[oldpts.length - 1];
        let lastsl = lastpt.slopeTo(oldpts[0]).toUnit();
        let newpts = [ ];
        for (let i=0; i<oldpts.length + 1; i++) {
            let nextpt = oldpts[i % oldpts.length];
            let nextsl = lastpt.slopeTo(nextpt).toUnit();
            let adiff = lastsl.angleDiff(nextsl, true);
            let bdiff = ((adiff < 0 ? (180 - adiff) : (180 + adiff)) / 2) + 180;
            if (isCW && adiff > 45) {
                let newa = BASE.newSlopeFromAngle(lastsl.angle + bdiff);
                newpts.push(lastpt.projectOnSlope(newa, dist));
                newpts.push(lastpt.clone());
            } else if (!isCW && adiff < -45) {
                let newa = BASE.newSlopeFromAngle(lastsl.angle - bdiff);
                newpts.push(lastpt.projectOnSlope(newa, dist));
                newpts.push(lastpt.clone());
            }
            lastsl = nextsl;
            lastpt = nextpt;
            if (i < oldpts.length) {
                newpts.push(nextpt);
            }
        }
        poly.points = newpts;
        poly.length = newpts.length;
        if (poly.inner) {
            CAM.addDogbones(poly.inner, dist, true);
        }
    };

    CAM.traces = function(settings, widget) {
        if (widget.traces) {
            // do no work if cached
            return false;
        }
        let slicer = new KIRI.slicer2(widget.getPoints(), {
            zlist: true,
            zline: true
        });
        let indices = [...new Set(Object.keys(slicer.zFlat)
            .map(kv => parseFloat(kv).round(5))
            .appendAll(Object.entries(slicer.zLine).map(ze => {
                let [ zk, zv ] = ze;
                return zv > 1 ? parseFloat(zk).round(5) : null;
            })
            .filter(v => v !== null)))]
            .sort((a,b) => b - a);

        // create shadow
        // let sindex = {};
        // let shadow = [];
        // let sindices = indices.map((v,i) => v > 0 ? v : v + 0.005);
        // slicer.slice(sindices, { each: (data, index, total) => {
        //     shadow = POLY.union(shadow.slice().appendAll(data.tops), 0, true);
        //     POLY.setZ(shadow, data.z);
        //     sindex[index] = shadow;
        // }, flatoff: 0 });
        let traces = [];
        // find and trim polys (including open) to shadow
        let oneach = (data, index, total) => {
            BASE.polygons.flatten(data.tops,null,true).forEach(poly => {
                poly.inner = null;
                poly.parent = null;
                let z = poly.getZ();
                for (let i=0, il=traces.length; i<il; i++) {
                    let trace = traces[i];
                    // only compare polys farther apart in Z
                    if (Math.abs(z - trace.getZ()) > 0.01) {
                        continue;
                    }
                    // do not add duplicates
                    if (traces[i].isEquivalent(poly)) {
                        return;
                    }
                }
                traces.push(poly);
                // do trimming
                // let trimto = sindex[index];
                // if (!trimto) {
                //     traces.push(poly);
                //     return;
                // }
                // trimto = trimto.clone(true);
                // if (poly.open) {
                //     let cuts = poly.cut(trimto);
                //     if (cuts.length) {
                //         traces.appendAll(cuts);
                //     } else {
                //         traces.push(poly);
                //     }
                // } else {
                //     let limit = 1000;
                //     while (trimto.length && limit-- > 0) {
                //         let trim = trimto.shift();
                //         let mask = poly.mask(trim, true);
                //         if (mask) {
                //             trimto.appendAll(mask);
                //         } else {
                //             traces.push(poly);
                //         }
                //     }
                //     if (limit === 1000) {
                //         traces.push(poly);
                //     }
                // }
            });
        };
        let opts = { each: oneach, over: false, flatoff: 0, edges: true, openok: true };
        slicer.slice(indices, opts);
        opts.over = true;
        slicer.slice(indices, opts);
        widget.traces = traces;
        // widget.sindex = sindex;
        return true;
    };

    // drilling op
    function sliceDrill(tool, slices, output) {
        let drills = [],
            drillToolDiam = tool.fluteDiameter(),
            centerDiff = drillToolDiam * 0.1,
            area = (drillToolDiam/2) * (drillToolDiam/2) * Math.PI,
            areaDelta = area * 0.05;

        // for each slice, look for polygons with 98.5% circularity whose
        // area is within the tolerance of a circle matching the tool diameter
        slices.forEach(function(slice) {
            let inner = slice.topPolyInners([]);
            inner.forEach(function(poly) {
                if (poly.circularity() >= 0.985 && Math.abs(poly.area() - area) <= areaDelta) {
                    let center = poly.circleCenter(),
                        merged = false,
                        closest = Infinity,
                        dist;
                    // TODO reject if inside camShellPolys (means there is material above)
                    // if (center.isInPolygon(camShellPolys)) return;
                    drills.forEach(function(drill) {
                        if (merged) return;
                        if ((dist = drill.last().distTo2D(center)) <= centerDiff) {
                            merged = true;
                            drill.push(center);
                        }
                        closest = Math.min(closest,dist);
                    });
                    if (!merged) {
                        drills.push(newPolygon().append(center));
                    }
                }
            });
        });

        // drill points to use center (average of all points) of the polygon
        drills.forEach(function(drill) {
            let center = drill.center(true),
                slice = newSlice(0,null);
            drill.points.forEach(function(point) {
                point.x = center.x;
                point.y = center.y;
            });
            slice.camMode = PRO.DRILL;
            slice.camLines = [ drill ];
            slice.output()
                .setLayer("drill", {face: 0, line: 0})
                .addPolys(drill);
            output.append(slice);
        });
    }

    // drill registration holes
    function sliceDrillReg(settings, output, zThru) {
        let proc = settings.process,
            stock = settings.stock,
            bounds = settings.bounds,
            mx = (bounds.max.x + bounds.min.x) / 2,
            my = (bounds.max.y + bounds.min.y) / 2,
            mz = zThru || 0,
            dx = (stock.x - (bounds.max.x - bounds.min.x)) / 4,
            dy = (stock.y - (bounds.max.y - bounds.min.y)) / 4,
            dz = stock.z,
            points = [];

        switch(proc.camDrillReg) {
            case "x axis":
                points.push(newPoint(bounds.min.x - dx, my, 0));
                points.push(newPoint(bounds.max.x + dx, my, 0));
                break;
            case "y axis":
                points.push(newPoint(mx, bounds.min.y - dy, 0));
                points.push(newPoint(mx, bounds.max.y + dy, 0));
                break;
        }

        if (points.length) {
            let slice = newSlice(0,null), polys = [];
            points.forEach(point => {
                polys.push(newPolygon()
                    .append(point.clone().setZ(bounds.max.z))
                    .append(point.clone().setZ(bounds.max.z - stock.z - mz)));
            });
            slice.camMode = PRO.DRILL;
            slice.camLines = polys;
            slice.output()
                .setLayer("register", {face: 0, line: 0})
                .addPolys(polys);
            output.append(slice);
        }
    }

    function cutTabs(tabs, offset, z) {
        let noff = [];
        tabs = tabs.filter(tab => z < tab.pos.z + tab.dim.z/2).map(tab => tab.off).flat();
        offset.forEach(op => noff.appendAll( op.cut(POLY.union(tabs)) ));
        if (noff.length > 1) {
            let heal = 0;
            // heal/rejoin open segments that share endpoints
            outer: for(;; heal++) {
                let ntmp = noff, tlen = ntmp.length;
                for (let i=0; i<tlen; i++) {
                    let s1 = ntmp[i];
                    if (!s1) continue;
                    for (let j=i+1; j<tlen; j++) {
                        let s2 = ntmp[j];
                        if (!s2) continue;
                        if (!(s1.open && s2.open)) continue;
                        if (s1.last().isMergable2D(s2.first())) {
                            s1.addPoints(s2.points.slice(1));
                            ntmp[j] = null;
                            continue outer;
                        }
                        if (s2.last().isMergable2D(s1.first())) {
                            s2.addPoints(s1.points.slice(1));
                            ntmp[i] = null;
                            continue outer;
                        }
                        if (s1.first().isMergable2D(s2.first())) {
                            s1.reverse();
                            s1.addPoints(s2.points.slice(1));
                            ntmp[j] = null;
                            continue outer;
                        }
                        if (s1.last().isMergable2D(s2.last())) {
                            s2.reverse();
                            s1.addPoints(s2.points.slice(1));
                            ntmp[j] = null;
                            continue outer;
                        }
                    }
                }
                break;
            }
            if (heal > 0) {
                // cull nulls
                noff = noff.filter(o => o);
            }
        }
        return noff;
    }

})();
