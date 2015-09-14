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
  this.objectIds = objectIds || [];
  this.args = args || [];
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
    var key = args[0];
    var val = args[1] || {};
    self.database[key] = self.database[key] || val;
  });
  this.opDefs.delete = new tytanic.ot.OpDef('delete', function(docs, args) {
    delete self.database[args[0]];
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
tytanic.ot.ClientOT = function(opDefs, clientId, sendFunc) {
  this.myOt = new tytanic.ot.CommonOT(opDefs);
  this.serverOt = new tytanic.ot.CommonOT(opDefs);
  this.log = [];
  this.database = this.myOt.database;
  this.canonDatabase = this.serverOt.database;
  this.clientId = clientId;
  this.ordering = 0;
  this.sendFunc = sendFunc || function(){};
};

tytanic.ot.ClientOT.prototype.run = function(opName, objectIds, args) {
  var op = new tytanic.ot.Op(opName, objectIds, args, this.clientId, this.ordering);
  this.log.push(op);
  this.ordering++;
  this.sendFunc(op);
  this.myOt.applyOp(op);
};

tytanic.ot.ClientOT.prototype.subscribe = function(objectIds) {
  var op = new tytanic.ot.Op('subscribe', objectIds, [], this.clientId, this.ordering);
  this.ordering++;
  this.sendFunc(op);
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
      if(op.opName === 'create') {
        serverOpObjIds = _.union(serverOpObjIds, [op.args[0]]);
      } else {
        serverOpObjIds = _.union(serverOpObjIds, op.objectIds || []);
      }
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

tytanic.ot.ClientHandle = function(clientId, sendFunc) {
  this.clientId = clientId;
  this.sendFunc = sendFunc;
};

tytanic.ot.ServerOT = function(opDefs) {
  this.myOt = new tytanic.ot.CommonOT(opDefs);
  this.clients = {};
  this.subscriptions = {};
};

tytanic.ot.ServerOT.prototype.addClient = function(clientId, sendFunc) {
  var client = new tytanic.ot.ClientHandle(clientId, sendFunc);
  this.clients[clientId] = client;
};

tytanic.ot.ServerOT.prototype.delClient = function(clientId) {
  delete this.clients[clientId];
};

tytanic.ot.ServerOT.prototype.recvOp = function(op) {
  /* notes for future: at some point we'll want to batch or otherwise
   * make asynchronous server-side operation application (because
   * there will be a need for locking and such).  this complicates the
   * initial subscription, as we'll either have to wait to have an
   * accurate current state of the object, or send the object plus the
   * oplog that is about to be applied to it.
   *
   * subscription is also awkward with respect to multi-object
   * operations. if there is a multi-object operation that occurs, and
   * i have only subscribed to one of the objects, i'll still need to
   * receive the update, but won't have the other objects in my local
   * database.  there are a few options. first option: we can give the
   * client a copy of the other objects temporarily, so it can run the
   * operation, then have the client delete the other objects which it
   * no longer cares about. another option: run the operation
   * server-side, then send down to the client a manufactured
   * operation which is just a "diff" of what happened. overall,
   * multi-object operations are tough... we might just punt on them
   * for a bit, and revisit them later.
   */
  if(op.opName === 'subscribe') {
    _.each(op.objectIds, function(oid) {
      this.subscriptions[oid] = this.subscriptions[oid] || [];
      this.subscriptions[oid].push(op.clientId);
      var obj = this.myOt.database[oid];
      if(obj !== undefined) {
        var cop = new tytanic.ot.Op('create', null, [oid, obj]);
        this.clients[op.clientId].sendFunc(cop);
      }
    }, this);
  } else {
    if(op.opName === 'create') {
      // if you create an object, you get subscribed to its updates
      var oid = op.args[0];
      this.subscriptions[oid] = this.subscriptions[oid] || [];
      this.subscriptions[oid].push(op.clientId);
      this.clients[op.clientId].sendFunc(op);
    }
    this.myOt.applyOp(op);
    var subscriberIds = _.uniq(_.flatten(_.map(op.objectIds, function(oid) {
      var tmp = this.subscriptions[oid] || [];
      return tmp;
    }, this)));
    _.each(subscriberIds, function(sid) {
      this.clients[sid].sendFunc(op);
    }, this);
  }
};
