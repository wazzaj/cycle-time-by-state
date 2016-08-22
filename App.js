var app = null;

Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    
    // kanbanField : "c_KanbanState",
    // kanbanField : "c_KanbanBoardOperation",
    // finalValue : "Done",
    
    launch: function() {
        //Write app code here
        console.log("launch");
        app = this;
        // this.startDate = moment().startOf('month').toISOString();
        // this.startDate = moment().subtract('month',6).toISOString();
        this.startDate = moment().subtract('month',app.getSetting("months")).toISOString();

        if ((app.getSetting("stateField") === "") &&
            (app.getSetting("finalValue") === "") &&
            (app.getSetting("storyType") === "")) {
            this.createUI();
        } else {
            app.type = app.getSetting("type");
            app.kanbanField = app.getSetting("stateField");
            app.finalValue  = app.getSetting("finalValue");
            app.storyType = app.getSetting("storyType");
        }

        var panel = Ext.create('Ext.container.Container', {
            itemId : 'panel',
            title: 'Hello',
            width: 800,
            height: 600,
            html: '<p></p>'
        });

        this.add(panel);
        var p = this.down("#panel");
        app.jqPanel = "#"+p.id;

        if (!((app.getSetting("stateField") === "") &&
            (app.getSetting("finalValue") === ""))) {
            app.run();
        }

    },

    config: {

    defaultSettings : {

        type : "STORY",
        stateField : "",
        finalValue : "",
        timeInHours : false,
        months : 6,
        storyType : ""
        }
    },

    getSettingsFields: function() {
        var values = [
            {
                name: 'stateField',
                xtype: 'rallytextfield',
                label : "Field name cycle time calculation is based on eg. State"
            },
            {
                name: 'finalValue',
                xtype: 'rallytextfield',
                label: 'Filter items that have moved into this state eg. Closed or Accepted'
            },
            {
                name: 'timeInHours',
                xtype: 'rallycheckboxfield',
                label: 'Show cycle time values in hours (instead of days)'
            },
            {
                name: 'months',
                xtype: 'rallytextfield',
                label: 'Number of months to consider'
            },            
            {
                name: 'storyType',
                xtype: 'rallytextfield',
                label: 'Comma delimited list of story types to include'
            }

        ];

        return values;
    },


    run : function () {

        app.mask = new Ext.LoadMask(Ext.getBody(), {msg:"Please wait..."});
        app.mask.show();
        
        async.waterfall([   
            app.getCompletedItems,
            app.getSnapshotsForCompletedItems,
            app.getProjectNamesForCompletedItems,
            app.prepareSnapshots,
            app.pivotData
            ], 
            function( err, results ) {
                app.mask.hide();
            }
        );
    },
    
    createUI : function() {
        
        var createButton = function() {
            if (app.goButton)
                app.goButton.destroy();
            app.goButton = Ext.create("Rally.ui.Button", {
                margin : 5,
                height : 20,
                text : "Go",
                handler: function() {
                    console.log("fieldCombo:",app.fieldCombo.getValue());
                    console.log("valueCombo:",app.valueCombo.getValue());
                    app.kanbanField = app.fieldCombo.getValue()
                    app.finalValue  = app.valueCombo.getValue()
                    app.run();
                }
            });
            app.boxcontainer.add(app.goButton);
            
        };
        
        var createValueCombo = function(valuefield) {
            if (app.valueCombo)
                app.valueCombo.destroy();
            
            app.valueCombo = Ext.create("Rally.ui.combobox.FieldValueComboBox", {
                padding : 5,
                
                stateful : true, stateId : "Rally.ui.combobox.FieldValueComboBox",
                model: 'UserStory',
                field: valuefield,
                listeners : {
                    ready : function(t) {
                        console.log("value ready",t.getValue());
                        if (t.getValue()!=="")
                            createButton();
                    },
                    select : function(a,selected,c) {
                        console.log("selected",selected[0].get("value"));
                        createButton();
                    }
                }
            });
            return app.valueCombo;
        };
        
        app.fieldCombo = Ext.create('Rally.ui.combobox.FieldComboBox', {
            padding : 5,
            stateful : true, stateId : "Rally.ui.combobox.FieldComboBox",
            model: 'UserStory',
            listeners : {
                ready : function(t,e) {
                    createValueCombo(t.getValue());
                    app.boxcontainer.add(app.valueCombo);
                },
                select : function(a,selected,c) {
                    console.log("selected",selected);
                    createValueCombo(selected[0].get("value"));
                    if (app.goButton) app.goButton.destroy();
                    app.boxcontainer.add(app.valueCombo);
                }
            }
        });
        
        app.boxcontainer = Ext.create('Ext.container.Container', {
            itemId : "container",
            layout: { type: 'hbox'},
            width: 400,
            border: 1,
            style: {borderColor:'#000000', borderStyle:'solid', borderWidth:'1px'},
            // padding : 5
        });
        app.boxcontainer.add(app.fieldCombo);
        this.add(app.boxcontainer);
        
    },

    getTypes : function() {

        var types = _.map( app.type.split(","), function(t) {
            return t.toUpperCase() !== "STORY" ? t : "HierarchicalRequirement";
        });
        console.log("types:",types);
        return types;
    },
    
    getStoryTypes : function() {

        var storyTypes = _.map( app.storyType.split(","));
        console.log("Story types:",storyTypes);
        return storyTypes;
    },

    // reads the snapshots for items that have been completed since the specified start date.
    getCompletedItems : function( callback ) {
        
        var that = this;

        var fetch = ['FormattedID','ObjectID','_TypeHierarchy','_PreviousValues','PlanEstimate','Project',app.kanbanField,'c_StoryType'];
        var hydrate = ['_TypeHierarchy',app.kanbanField];
        
        var find = {
                // '_TypeHierarchy' : { "$in" : ["HierarchicalRequirement","Defect"]} ,
                '_TypeHierarchy' : { "$in" : app.getTypes() } ,
                '_ProjectHierarchy' : { "$in": [app.getContext().getProject().ObjectID] },
                // 'Children' : { "$exists" : false}
        };
        // for stories only include child level items
        if ( _.findIndex(app.getTypes(),function(t){
            return t.toUpperCase()==="HIERARCHICALREQUIREMENT";
        }) !== -1) {
            find['Children'] = { "$exists" : false}
        }

        find[app.kanbanField] =  app.finalValue;
        find["_PreviousValues."+app.kanbanField] =  {"$ne" : null };
        find["_ValidFrom"] = { "$gte" : app.startDate };
        find["c_StoryType"] = { "$in" : app.getStoryTypes() };

        var storeConfig = {
            find : find,
            autoLoad : true,
            pageSize:1000,
            limit: 'Infinity',
            fetch: fetch,
            hydrate: hydrate,
            listeners : {
                scope : this,
                load: function(store, snapshots, success) {
                    console.log("success",success);
                    console.log("completed snapshots:", snapshots.length);
                    console.log("unique completed   :", _.uniq(_.map(snapshots,function(s){return s.get("ObjectID");})).length);
                    callback(null,snapshots);
                }
            }
        };

        var snapshotStore = Ext.create('Rally.data.lookback.SnapshotStore', storeConfig);
        console.log(storeConfig);
        
    },

    // will process the snapshots adding additional elements
    prepareSnapshots : function(completedItems, snapshots,callback) {

        _.each(snapshots, function(s) {
            // set the month
            var ci = _.find(completedItems,function(c) { return c.get("ObjectID") === s.get("ObjectID");});
            var month = moment(ci.get("_ValidFrom")).format ("MMM YYYY");
            s.set("CompletedDate",ci.get("_ValidFrom"));
            s.set("Month",month);
            s.set("Size",ci.get("PlanEstimate"));
//            s.set("Type",ci.get("c_StoryType"));  // Warren 
        });

        callback( null, completedItems, snapshots );

    },

    pivotData : function( completedItems, snapshots, callback ) {

        var addCommas = function(nStr) {
            var rgx, x, x1, x2;
            nStr += '';
            x = nStr.split('.');
            x1 = x[0];
            x2 = x.length > 1 ? '.' + x[1] : '';
            rgx = /(\d+)(\d{3})/;
            while (rgx.test(x1)) {
              x1 = x1.replace(rgx, '$1' + ',' + '$2');
            }
            return x1 + x2;
          };

        var numberFormat = function(sigfig, scaler) {
            if (sigfig == null) {
              sigfig = 3;
            }
            if (scaler == null) {
              scaler = 1;
            }
            return function(x) {
              if (x === 0 || isNaN(x) || !isFinite(x)) {
                return "";
              } else {
                return addCommas((scaler * x).toFixed(sigfig));
              }
            };
        };

        var cycleTime = function() {

          return function(x,y,z) {
            var xx = x;
            var yy = y;
            var zz = z;
            return {
              recs : [],

              push: function(record) {
                this.recs.push(record);
                // return this.count++;
                return this.recs.length;
              },
              value: function(value) {
                console.log("Records for:",yy,zz);
                // console.log("calculating cycle time for #records:",this.recs.length);
                // console.log("#records:",this.recs);
                var ct = (calcCyleTime(this.recs));
                // console.log("ct",ct);
                console.log("#ids",_.pluck(ct,"FormattedID"));
                console.log("#cycletimes",_.pluck(ct,"ticks"));
                var mean = _.mean( _.pluck(ct,"ticks"));
                var median = _.median( _.pluck(ct,"ticks"));
                var max = _.max( _.pluck(ct,"ticks"));
                var min = _.min( _.pluck(ct,"ticks"));
                var cnt = _.pluck(ct,"ticks").length;
                var stddev = _.stdDeviation(_.pluck(ct,"ticks"));
                var cov = (mean!==0) ?stddev / mean : 0;
                mean = parseFloat(Math.round(mean * 100) / 100).toFixed(2);
                median = parseFloat(Math.round(median * 100) / 100).toFixed(2);
                stddev = parseFloat(Math.round(stddev * 100) / 100).toFixed(2);
                cov    = parseFloat(Math.round(cov * 100) / 100).toFixed(2);

                console.log("cnt/mean/median/max/min/stddev/cov",cnt,",",mean,",",median,",",max,",",min,",",stddev,",",cov);
                return mean
              },
              format: numberFormat(0),
              label: "cycleTime"
            };
          };
        };

        var calcCyleTime = function( snapshots ) {
                // console.time("cycle-time");
                var that = this;
                // var granularity = 'day';
                var granularity = app.getSetting("timeInHours") === false ? 'day' : 'hour';
                var tz = 'America/New_York';
                
                var config = { //  # default work days and holidays
                    granularity: granularity,
                    tz: tz,
                    validFromField: '_ValidFrom',
                    validToField: '_ValidTo',
                    // uniqueIDField: 'ObjectID',
                    uniqueIDField: 'FormattedID',
                    workDayStartOn: {hour: 13, minute: 0}, // # 09:00 in Chicago is 15:00 in GMT
                    workDayEndBefore: {hour: 22, minute: 0} // # 11:00 in Chicago is 17:00 in GMT  # 
                };
                
                // var start = moment().dayOfYear(0).toISOString();
                var start = moment().subtract(1, 'years').toISOString();
                var end =   moment().toISOString();
                var tisc = null;
                if (_.isUndefined(window.parent._lumenize)) {
                    tisc = new window._lumenize.TimeInStateCalculator(config);
                } else {
                    tisc = new window.parent._lumenize.TimeInStateCalculator(config);
                }
                tisc.addSnapshots(snapshots, start, end);
                var results = tisc.getResults();
                console.timeEnd("cycle-time");
                // callback(null,results);
                return results;
        };

        var teamNameDeriver = function(record) {

            var p = _.find(app.projects, function(f) { return record.Project === f.get("ObjectID");});

            return p ? p.get("Name") : record.Project;

        };

        var completedDateDeriver = function(record) {
            return moment(record.CompletedDate).format ("MMM YYYY");
        }

        var data = _.map(snapshots,function(s) { 
            return s.data;
        });

        $(app.jqPanel).pivotUI(
            data,                    
            {
                derivedAttributes : { "Team" : teamNameDeriver, "MonthCompleted" : completedDateDeriver },
                aggregators : { cycleTime : cycleTime },
                rows: [app.kanbanField],
                cols: ["Team"],
                hiddenAttributes : ["PlanEstimate", "ObjectID","_TypeHierarchy","_UnformattedID","_ValidFrom","_ValidTo","Project","CompletedDate"]
            }
        );
        
        callback( null, completedItems, snapshots );
    },

    readSnapshots : function( config, callback) {
        console.log("reading page of snapshots...");
         var storeConfig = {
            find : config.find,
            autoLoad : true,
            pageSize:1000,
            limit: 'Infinity',
            fetch: config.fetch,
            hydrate: config.hydrate,
            listeners : {
                scope : this,
                load: function(store, snapshots, success) {
                    callback(null,snapshots);
                }
            }
        };
        var snapshotStore = Ext.create('Rally.data.lookback.SnapshotStore', storeConfig);
    },

    getProjectNamesForCompletedItems : function(completedItems,snapshots,callback) {

        var projectOids = _.uniq(_.pluck( snapshots, function(c) { return c.get("Project");}) );
        console.log("Distinct Project IDs:",projectOids);

        var configs = _.map(projectOids, function(p) {
            return {
                    model : "Project",
                    fetch : ["Name","ObjectID","FormattedID"],
                    filters : [{property:"ObjectID",value:p}]
                };
        });

        async.map(configs,app.wsapiQuery,function(err,results) {

            app.projects = _.flatten(results);

            // remove snapshots where the project was not found (out of scope, closed etc.)
            var filteredSnapshots = _.filter(snapshots,function(s) {
                var p = _.find( app.projects, function(p) { 
                    return s.get("Project")===p.get("ObjectID");
                });
                return !_.isUndefined(p) && !_.isNull(p);
            });

            console.log("projects:",app.projects);
            // pass on to next function in the chain.
            callback(null,completedItems,filteredSnapshots);

        });

    },
    
    getSnapshotsForCompletedItems : function(completedItems,callback) {

        var that = this;

        var completedOids = _.uniq( _.pluck( completedItems, function(c) { return c.get("ObjectID"); } ));        
        console.log("oids",completedOids.length);

        var oidsArrays = [];
        var i,j,chunk = 50;
        for (i=0, j=completedOids.length; i<j; i+=chunk) {          
            oidsArrays.push(completedOids.slice(i,i+chunk));
        }
        console.log("oidsArrays",oidsArrays);

        var configs = _.map( oidsArrays, function(oArray) {
            return {
                fetch : ['FormattedID','_UnformattedID','ObjectID','_TypeHierarchy','PlanEstimate', 'ScheduleState', 'c_StoryType', app.kanbanField],
                hydrate : ['_TypeHierarchy','ScheduleState',app.kanbanField],
                find : {
                    // '_TypeHierarchy' : { "$in" : ["HierarchicalRequirement","Defect"]} ,
                    '_TypeHierarchy' : { "$in" : app.getTypes() } ,
                    '_ProjectHierarchy' : { "$in": [app.getContext().getProject().ObjectID] }, 
                    'ObjectID' : { "$in" : oArray }
                }
            }
        })

        async.mapSeries( configs, app.readSnapshots, function(err,results) {

            var snapshots = [];
            _.each(results,function(r) {
                snapshots = snapshots.concat(r);
            });
            console.log("total snapshots",snapshots.length);
            callback(null,completedItems,snapshots)

        });


    }, 
    
    summarizeResults : function( stateResults, callback ) {
      
        _.each(stateResults, function(result) {
            
            var resultTicks = _.pluck(result.results, function(r) { return r.ticks; });
            result.min = _.min( resultTicks ) ;
            result.max = _.max( resultTicks );
            result.avg = _.reduce(resultTicks, function(memo, num) {
        		    return memo + num;
                }, 0) / resultTicks.length;
                
            result.median = _.median( _.sortBy(resultTicks) , function(r) { return r;});
            result.mean   = _.mean( resultTicks , function(r) { return r;});
            result.ticks = _.sortBy(resultTicks);
        });
        callback(null,stateResults);
        
    },
    
    wsapiQuery : function( config , callback ) {
        Ext.create('Rally.data.WsapiDataStore', {
            autoLoad : true,
            limit : "Infinity",
            model : config.model,
            fetch : config.fetch,
            filters : config.filters,
            // context: config.context,
            listeners : {
                scope : this,
                load : function(store, data) {
                    callback(null,data);
                }
            }
        });
    }

});
