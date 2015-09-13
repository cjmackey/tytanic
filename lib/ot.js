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

tytanic.ot.Op = function(opName, objectIds, args) {
  this.opName = opName;
  this.objectIds = objectIds;
  this.args = args;
};

tytanic.ot.CommonOT = function(opDefs) {
  var self = this;
  this.database = {};
  this.opDefs = {};
  _.each(opDefs || [], function(opDef) {
    this.opDefs[opDef.name] = opDef;
  }, this);
  this.opDefs['create'] = new tytanic.ot.OpDef('create', function(docs, args) {
    _.each(args, function(arg) {
      self.database[arg] = {};
    });
  });
  this.opDefs['delete'] = new tytanic.ot.OpDef('delete', function(docs, args) {
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
