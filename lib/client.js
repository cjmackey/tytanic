/*jshint node:true */
/*global window:false */
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
tytanic.subscriptions.<objectId> (if present, we want to subscribe to this on reconnection)

*/

tytanic.client.hexpad = function(number, length) {
  var s = Math.floor(number).toString(16);
  while(s.length < length) {
    s = '0' + s;
  }
  return s;
};

tytanic.client.Client = function(options) {
  options = options || {};
  this.opDefs = options.opDefs || new tytanic.op.OpDefs();
  this.localStoragePrefix = options.localStoragePrefix || 'tytanic';
  this.localStorage = options.localStorage || window.localStorage;
  this.objects = {}; // objects in memory (NOT in localStorage, as these are not canonical)
  this.connection = null;
  this.changeHandler = options.changeHandler;
  this.reconnectInterval = null;
};

tytanic.client.Client.prototype.op = function(opName, func) {
  this.opDefs.op(opName, func);
  return this;
};

tytanic.client.Client.prototype.setReconnection = function() {
  // this interval runs while not connected, and basically just tries to connect every 5 seconds.
  var self = this;
  if(!self.reconnectInterval) {
    self.reconnectInterval = window.setInterval(function () {
      console.log('attempting reconnection');
      self.init();
    }, 5000);
  }
};

tytanic.client.Client.prototype.init = function() {
  var self = this;
  _.each(self.listLocalStorageKeys(), function(key) {
    if(key.indexOf(self.localStoragePrefix + '.subscriptions.') === 0) {
      self.regenerateObject(key.slice((self.localStoragePrefix + '.subscriptions.').length));
    }
  });
  this.setReconnection();
  // connect this.connection
  this.connection = new SockJS('/sock');
  this.connection.onopen = function() {
    clearInterval(self.reconnectInterval);
    self.reconnectInterval = null;
    _.each(self.listLocalStorageKeys(), function(key) {
      if(key.indexOf(self.localStoragePrefix + '.subscriptions.') === 0) {
        self.subscribe(key.slice((self.localStoragePrefix + '.subscriptions.').length), true);
      }
    });
    _.each(self.listLocalStorageKeys(), function(key) {
      if(key.indexOf(self.localStoragePrefix + '.localOps.') === 0) {
        var op = JSON.parse(self.localStorage.getItem(key));
        self.send({
          messageType: 'op',
          op: op
        });
      }
    });
  };
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
    self.setReconnection();
  };
};

tytanic.client.newNonce = function() {
  return (tytanic.client.hexpad((new Date()).getTime(), 12) +
          tytanic.client.hexpad(Math.random() * 4294967296, 8) +
          tytanic.client.hexpad(Math.random() * 4294967296, 8));
};

tytanic.client.Client.prototype.receiveOpFail = function(op) {
  var localKey = this.localStoragePrefix + '.localOps.' + op.objectId + '.' + op.clientNonce;
  this.localStorage.removeItem(localKey);
  this.regenerateObject(op.objectId);
};

tytanic.client.Client.prototype.receiveOp = function(op) {
  var objectId = op.objectId;
  // delete local op if this matches
  var localKey = this.localStoragePrefix + '.localOps.' + objectId + '.' + op.clientNonce;
  if(this.localStorage.getItem(localKey)) {
    this.localStorage.removeItem(localKey);
  }
  // unless the snap is newer than this op, add it to our database.
  var snapKey = this.localStoragePrefix + '.snaps.' + objectId;
  var snapJson = this.localStorage.getItem(snapKey);
  if(!(snapJson && JSON.parse(snapJson).opId >= op.objectId)) {
    var key = this.localStoragePrefix + '.ops.' + objectId + '.' + tytanic.client.hexpad(op.id, 16);
    this.localStorage.setItem(key, JSON.stringify(op));
  }
  this.regenerateObject(objectId);
};

tytanic.client.Client.prototype.receiveSnap = function(snap) {
  var self = this;
  var objectId = snap.objectId;
  var snapKey = this.localStoragePrefix + '.snaps.' + objectId;
  var currentSnapJson = this.localStorage.getItem(snapKey);
  if(currentSnapJson && JSON.parse(currentSnapJson).opId > snap.opId) {
    return;
  }
  this.localStorage.setItem(snapKey, JSON.stringify(snap));

  // clear out any ops whose id's are less than or equal to snap.opId
  _.each(self.listLocalStorageKeys(), function(key) {
    if(key.indexOf(self.localStoragePrefix + '.ops.' + objectId + '.') === 0) {
      if(key <= self.localStoragePrefix + '.ops.' + objectId + '.' + tytanic.client.hexpad(snap.opId, 16)) {
        self.localStorage.removeItem(key);
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
  this.send({
    messageType: 'op',
    op: op
  });
  this.localStorage.setItem(this.localStoragePrefix + '.localOps.' + objectId + '.' + op.clientNonce, JSON.stringify(op));
  this.regenerateObject(objectId);
};

tytanic.client.Client.prototype.subscribe = function(objectId, isReSub) {
  if(!isReSub) {
    this.localStorage.setItem(this.localStoragePrefix + '.subscriptions.' + objectId, true);
  }
  var lastOpId = null;
  var snap = this.localStorage.getItem(this.localStoragePrefix + '.snaps.' + objectId);
  if(snap) {
    lastOpId = snap.opId;
  }
  this.send({
    messageType: 'subscribe',
    objectId: objectId,
    opId: lastOpId
  });
};

tytanic.client.Client.prototype.unsubscribe = function(objectId) {
  this.localStorage.removeItem(this.localStoragePrefix + '.subscriptions.' + objectId);
  this.send({
    messageType: 'unsubscribe',
    objectId: objectId
  });
};

tytanic.client.Client.prototype.send = function(data) {
  if(this.connection) {
    this.connection.send(JSON.stringify(data));
  }
};

tytanic.client.Client.prototype.listLocalStorageKeys = function() {
  var keys = [];
  for(var key in this.localStorage) {
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
      localOps.push(JSON.parse(self.localStorage.getItem(key)));
    }
    if(key.indexOf(self.localStoragePrefix + '.ops.' + objectId + '.') === 0) {
      ops.push(JSON.parse(self.localStorage.getItem(key)));
    }
    if(key === self.localStoragePrefix + '.snaps.' + objectId) {
      object = JSON.parse(self.localStorage.getItem(key)).data;
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
