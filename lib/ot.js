/*jshint node:true */
'use strict';

if(typeof require !== 'undefined'){
  var _ = require('lodash');
}

var tytanic = tytanic || {};

tytanic.ot = {};

if(typeof module !== 'undefined') {
  module.exports = tytanic.ot;
}

/*
 * Operations' "action" functions take two arguments: first, an array of documents, and second an array of action arguments.
 *
 */



tytanic.ot.OpDef = function(name, action) {
  this.name = name;
  this.action = action;
};

tytanic.ot.Op = function(opName, objectIds, args, clientId, ordering) {
  this.opName = opName;
  this.objectIds = objectIds;
  this.args = args;
  this.clientId = clientId;
  this.ordering = ordering;
};

tytanic.ot.CommonOT = function(opDefs) {
  // someday, make the "database" portion of this somehow pluggable,
  // so it's not just something living in memory.
  var self = this;
  this.database = {};
  this.opDefs = {};
  _.each(opDefs || [], function(opDef) {
    this.opDefs[opDef.name] = opDef;
  }, this);
  this.opDefs.create = new tytanic.ot.OpDef('create', function(docs, args) {
    _.each(args, function(arg) {
      self.database[arg] = self.database[arg] || {};
    });
  });
  this.opDefs.delete = new tytanic.ot.OpDef('delete', function(docs, args) {
    _.each(args, function(arg) {
      delete self.database[arg];
    });
  });
};

tytanic.ot.CommonOT.prototype.applyOp = function(op) {
  var objects = _.map(op.objectIds || [], function(oid) {
    return this.database[oid];
  }, this);
  this.opDefs[op.opName].action(objects, op.args || []);
};

/*
 * for every browser tab, generate a random clientId
 */
tytanic.ot.ClientOT = function(opDefs, clientId) {
  this.myOt = new tytanic.ot.CommonOT(opDefs);
  this.serverOt = new tytanic.ot.CommonOT(opDefs);
  this.log = [];
  this.database = this.myOt.database;
  this.canonDatabase = this.serverOt.database;
  this.clientId = clientId;
  this.ordering = 0;
};

tytanic.ot.ClientOT.prototype.run = function(opName, objectIds, args) {
  var op = new tytanic.ot.Op(opName, objectIds, args, this.clientId, this.ordering);
  this.log.push(op);
  this.ordering++;
  this.myOt.applyOp(op);
};

tytanic.ot.ClientOT.prototype.receiveOps = function(ops) {
  var serverOpObjIds = [];
  var clientOpObjIds = [];
  var serverOrdering = -1;
  _.each(ops, function(op) {
    this.serverOt.applyOp(op);
    if(op.clientId === this.clientId) {
      serverOrdering = Math.max(op.ordering, serverOrdering);
    } else {
      serverOpObjIds = _.union(serverOpObjIds, op.objectIds || []);
    }
  }, this);
  this.log = _.filter(this.log, function(op) {
    return op.ordering > serverOrdering;
  });
  if(serverOpObjIds.length > 0) { // some things changed
    _.each(this.log, function(op) {
      clientOpObjIds = _.union(clientOpObjIds, op.objectIds || []);
    });
    var needRerun = Boolean(_.intersection(serverOpObjIds, clientOpObjIds).length);
    var toCopy = serverOpObjIds;
    if(needRerun) {
      toCopy = toCopy.concat(clientOpObjIds);
    }
    _.each(toCopy, function(objectId) {
      this.database[objectId] = _.cloneDeep(this.canonDatabase[objectId]);
    }, this);
    if(needRerun) {
      _.each(this.log, function(op) {
        this.myOt.applyOp(op);
      }, this);
    }
  }
};
