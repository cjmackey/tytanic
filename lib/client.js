/*jshint node:true */
/*global localStorage:false */
/*global SockJS:false */
'use strict';

var tytanic = tytanic || {};
tytanic.client = {};

if(typeof require !== 'undefined'){
  var _ = require('lodash');
  tytanic.op = require('./op.js');
}

if(typeof module !== 'undefined') {
  module.exports = tytanic.client;
}

/*

Data is stored in localstorage. assuming default key prefixes, it would look like this:

tytanic.snaps.<objectId> (the latest snap we've seen from the server)
tytanic.ops.<objectId>.<id (in hex, padded to 64-bits a.k.a. 16 chars)> (the ops we've seen from the server. once we've received a snap, we can clear out any older ops related to that object id)
tytanic.localOps.<objectId>.<clientNonce> (the ops we've been creating, but may not have seen from the server yet)

TODO: maybe keep track of subscriptions?

*/

tytanic.client.hexpad = function(number, length) {
  var s = Math.floor(number).toString(16);
  while(s.length < length) {
    s = '0' + s;
  }
  return s;
};

tytanic.client.Client = function(opDefs, localStoragePrefix) {
  this.opDefs = opDefs || new tytanic.op.OpDefs();
  this.localStoragePrefix = localStoragePrefix || 'tytanic';
  this.objects = {}; // snapshots in memory (NOT in localStorage; these are not canonical)
  this.connection = null;
  this.changeHandler = null;
};

tytanic.client.Client.prototype.init = function() {
  var self = this;
  // connect this.connection
  this.connection = new SockJS('/sock');
  this.connection.onmessage = function(message) {
    var data = JSON.parse(message.data);
    console.log(data);
    switch(data.messageType) {
    case 'op':
      self.receiveOp(data.op);
      break;
    case 'snap':
      self.receiveSnap(data.snap);
      break;
    case 'opFail':
      self.receiveOpFail(data.op);
    }
  };
  this.connection.onclose = function() {
    // we got disconnected, so we'll need to recreate the sockjs socket and re-synchronize.
    self.init();
  }
  // TODO: load data from localstorage into this.db ?
};

tytanic.client.newNonce = function() {
  return (tytanic.client.hexpad((new Date()).getTime(), 12) +
          tytanic.client.hexpad(Math.random() * 4294967296, 8) +
          tytanic.client.hexpad(Math.random() * 4294967296, 8));
};

tytanic.client.Client.prototype.receiveOpFail = function(op) {
  var localKey = this.localStoragePrefix + '.localOps.' + op.objectId + '.' + op.clientNonce;
  localStorage.removeItem(localKey);
  this.regenerateObject(op.objectId);
};

tytanic.client.Client.prototype.receiveOp = function(op) {
  var objectId = op.objectId;
  // delete local op if this matches
  var localKey = this.localStoragePrefix + '.localOps.' + objectId + '.' + op.clientNonce;
  if(localStorage.getItem(localKey)) {
    localStorage.removeItem(localKey);
  }
  // unless the snap is newer than this op, add it to our database.
  var snapKey = this.localStoragePrefix + '.snaps.' + objectId;
  var snapJson = localStorage.getItem(snapKey);
  if(!(snapJson && JSON.parse(snapJson).opId >= op.objectId)) {
    var key = this.localStoragePrefix + '.ops.' + objectId + '.' + tytanic.client.hexpad(op.id, 16);
    localStorage.setItem(key, JSON.stringify(op));
  }
  this.regenerateObject(objectId);
};

tytanic.client.Client.prototype.receiveSnap = function(snap) {
  var self = this;
  var objectId = snap.objectId;
  var snapKey = this.localStoragePrefix + '.snaps.' + objectId;
  var currentSnapJson = localStorage.getItem(snapKey);
  if(currentSnapJson && JSON.parse(currentSnapJson).opId > snap.opId) {
    return;
  }
  localStorage.setItem(snapKey, JSON.stringify(snap));

  // clear out any ops whose id's are less than or equal to snap.opId
  _.each(self.listLocalStorageKeys(), function(key) {
    if(key.indexOf(self.localStoragePrefix + '.ops.' + objectId + '.') === 0) {
      if(key <= self.localStoragePrefix + '.ops.' + objectId + '.' + tytanic.client.hexpad(snap.opId, 16)) {
        localStorage.removeItem(key);
      }
    }
  });

  this.regenerateObject(objectId);
};

tytanic.client.Client.prototype.run = function(opName, objectId, args) {
  var op = {
    opName: opName,
    objectId: objectId,
    args: args,
    clientNonce: tytanic.client.newNonce()
  };
  this.connection.send(JSON.stringify({
    messageType: 'op',
    op: op
  }));
  localStorage.setItem(this.localStoragePrefix + '.localOps.' + objectId + '.' + op.clientNonce, JSON.stringify(op));
  this.regenerateObject(objectId);
};

tytanic.client.Client.prototype.subscribe = function(objectId) {
  var lastOpId = null;
  var snap = localStorage.getItem(this.localStoragePrefix + '.snaps.' + objectId);
  if(snap) {
    lastOpId = snap.opId;
  }
  this.connection.send(JSON.stringify({
    messageType: 'subscribe',
    objectId: objectId,
    opId: lastOpId
  }));
};

tytanic.client.Client.prototype.unsubscribe = function(objectId) {
  this.connection.send(JSON.stringify({
    messageType: 'unsubscribe',
    objectId: objectId
  }));
};

tytanic.client.Client.prototype.listLocalStorageKeys = function() {
  var keys = [];
  for(var key in localStorage) {
    keys.push(key);
  }
  return keys.sort();
};

tytanic.client.Client.prototype.regenerateObject = function(objectId) {
  var self = this;
  var keys = self.listLocalStorageKeys();
  var object = {};
  var ops = [];
  var localOps = [];
  _.each(keys, function(key) {
    if(key.indexOf(self.localStoragePrefix + '.localOps.' + objectId + '.') === 0) {
      localOps.push(JSON.parse(localStorage.getItem(key)));
    }
    if(key.indexOf(self.localStoragePrefix + '.ops.' + objectId + '.') === 0) {
      ops.push(JSON.parse(localStorage.getItem(key)));
    }
    if(key === self.localStoragePrefix + '.snaps.' + objectId) {
      object = JSON.parse(localStorage.getItem(key)).data;
    }
  });
  _.each(ops.concat(localOps), function(op) {
    self.opDefs.run(op.opName, object, op.args);
  });
  self.objects[objectId] = object;
  if(self.changeHandler) {
    self.changeHandler(objectId, object);
  }
};
