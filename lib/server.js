/*jshint node:true */
'use strict';

var _ = require('lodash');
var express = require('express');
var http = require('http');
var path = require('path');
var Promise = require("bluebird");
var redis = require('redis');
var Sequelize = require('sequelize');
var sockjs = require('sockjs');

var op = require('./op.js');

function Server(opDefs) {
  this.blah = 'blah';
  this.subscriptions = {}; // objectId: {subscribers: {connId: conn}, lastId: int}
  this.connectionSubs = {}; // connId: {objectId: true}
  this.subRedis = null;
  this.pubRedis = null;
  this.opDefs = opDefs || new op.OpDefs();
}

function cleanseOp(op) {
  op.objectId = op.objectId.toString();
  op.opName = (op.opName || '').toString();
  op.args = JSON.parse(op.args);
  op.clientNonce = (op.clientNonce || '').toString();
  delete op.createdAt;
  delete op.updatedAt;
  return op;
}

function cleanseSnap(snap) {
  snap.objectId = snap.objectId.toString();
  delete snap.createdAt;
  delete snap.updatedAt;
  return snap;
}

// TODO: maybe change the schema to not use blobs, or do something better around strings vs bytestrings? right now dealing with buffers the way i am doing now is annoying and probably incorrect anyway.

// TODO: be resilient to redis failures. one option: if redis disconnects, we keep retrying, and once we have reconnected (e.g. to a backup redis or something), we go through all our subscriptions and re-get their most recent snap and logs from the db and push that down to clients. that would handle concerns around some servers storing operations in the db but not publishing them (because redis was down). Note that in the event of an individual server failure, the client will reconnect (possibly to a different server), and re-request all its subscriptions and re-upload all its unconfirmed local ops.

// TODO: have a way of clearing out ops that are very old to save space. if we have a snapshot, then the only reason to keep ops older than that snapshot around is to accomodate very out-of-date clients who might have submitted those ops but haven't heard back (and thus haven't cleared them out of localOps). we'd still want a way to work with very-out-of-date clients though... not sure what that'd be, other than effectively wiping out their localStorage. We could preserve compatibility be just nulling out the ops' data other than id, objectId, and clientNonce, so it saves a bit of space. Or we could store somewhere the most recent clientNonce from each client somehow, and when a client reconnects, it can probably safely discard anything much older than that.

Server.prototype.receiveRedisSnapMessage = function(channel, message) {
  var self = this;
  return new Promise(function(resolve, reject) {
    var objectId = channel.slice('tytanic.snap.'.length);
    var sub = self.subscriptions[objectId];
    if(!sub) {
      return resolve();
    }
    var newSnap = JSON.parse(message);
    _.each(sub.subscribers, function(conn) {
      conn.write(JSON.stringify({
        messageType: 'snap',
        snap: cleanseSnap(newSnap),
      }));
    });
    resolve();
  });
};

Server.prototype.receiveRedisOpMessage = function(channel, message) {
  var self = this;
  return new Promise(function(resolve, reject) {
    var objectId = channel.slice('tytanic.op.'.length);
    var sub = self.subscriptions[objectId];
    if(!sub) {
      return resolve();
    }
    var lastId = sub.lastId;
    var newOp = JSON.parse(message);
    var newId = newOp.id;
    if(newId <= lastId) {
      return resolve();
    }
    _.each(sub.subscribers, function(conn) {
      conn.write(JSON.stringify({
        messageType: 'op',
        op: newOp,
      }));
    });
    sub.lastId = _.max([lastId || -1], newId);
    resolve();
  });
};

Server.prototype.receiveRedisMessage = function(channel, message) {
  var self = this;
  return new Promise(function(resolve, reject) {
    if(channel.indexOf('tytanic.op.') === 0) {
      self.receiveRedisOpMessage(channel, message).then(resolve);
    } else if(channel.indexOf('tytanic.snap.') === 0) {
      self.receiveRedisSnapMessage(channel, message).then(resolve);
    } else {
      resolve();
    }
  });
};

Server.prototype.getSnap = function(objectId) {
  return new Promise(function(resolve, reject) {
    models.Snap.findOne({
      where: {objectId: objectId},
      order: [['opId', 'DESC'], ['id', 'DESC']],
    }).then(function(result) {
      if(result) {
        var snap = result.dataValues;
        snap.objectId = objectId.toString();
        snap.data = JSON.parse(snap.data);
        resolve(snap);
      } else {
        resolve({objectId: objectId, opId: null, data: {}});
      }
    });
  });
};

Server.prototype.getSnapAndLogs = function(objectId) {
  var self = this;
  return new Promise(function(resolve, reject) {
    self.getSnap(objectId).then(function(snap) {
      models.Op.findAll({
        where: {objectId: objectId, id: {$gt: snap.opId || -1}},
        order: [['id', 'ASC']],
      }).then(function(result) {
        var ops = _.pluck(result, 'dataValues');
        _.each(ops, cleanseOp);
        resolve([snap, ops]);
      });
    });
  });
};

Server.prototype.runOp = function(object, op) {
  this.opDefs.run(op.opName, object, op.args);
};

Server.prototype.createSnap = function(objectId) {
  var self = this;
  return new Promise(function(resolve, reject) {
    self.getSnapAndLogs(objectId).spread(function(snap, ops) {
      // TODO: if the number of ops is zero... maybe don't create a snap, and just return the existing one?
      var object = snap.data;
      _.each(ops, function(op) {
        self.runOp(object, op);
      });
      snap.data = JSON.stringify(object);
      delete snap.id;
      if(ops.length > 0) {
        snap.opId = _.last(ops).id;
      }
      models.Snap.create(snap).then(function(result) {
        var snap = result.dataValues;
        snap.data = JSON.parse(snap.data);
        self.pubRedis.publish('tytanic.snap.' + objectId,
                              JSON.stringify(cleanseSnap(snap)));
        resolve(snap);
      });
    });
  });
};

Server.prototype.subscribe = function(conn, objectId) {
  if(!this.subscriptions[objectId]) {
    this.subscriptions[objectId] = {subscribers: {}, lastId: -1};
    this.subRedis.subscribe('tytanic.op.' + objectId);
    this.subRedis.subscribe('tytanic.snap.' + objectId);
  }
  var sub = this.subscriptions[objectId];
  if(sub.subscribers[conn.id]) {
    // already subscribed!
    return;
  }
  sub.subscribers[conn.id] = conn;
  this.connectionSubs[conn.id] = this.connectionSubs[conn.id] || {};
  this.connectionSubs[conn.id][objectId] = true;
};

Server.prototype.unsubscribe = function(conn, objectId) {
  var shouldUnsubscribe = false;
  var sub = this.subscriptions[objectId];
  if(sub) {
    delete sub.subscribers[conn.id];
    shouldUnsubscribe = _.isEmpty(sub.subscribers);
  }
  if(this.connectionSubs[conn.id]) {
    delete this.connectionSubs[conn.id][objectId];
  }
  if(shouldUnsubscribe) {
    this.subRedis.unsubscribe('tytanic.op.' + objectId);
    this.subRedis.unsubscribe('tytanic.snap.' + objectId);
    delete this.subscriptions[objectId];
  }
};

Server.prototype.closeConn = function(conn) {
  var self = this;
  _.each(this.connectionSubs[conn.id] || {}, function(t, objectId) {
    self.unsubscribe(conn, objectId);
  });
  delete this.connectionSubs[conn.id];
};

Server.prototype.receiveMessage = function(data, conn) {
  var self = this;
  return new Promise(function(resolve) {
    switch(data.messageType) {
    case 'op':
      console.log(data.op);
      var dbOp = _.cloneDeep(data.op);
      dbOp.args = JSON.stringify(dbOp.args);
      // TODO: if the clientNonce already exists... we need to do something smarter. maybe send the op as it is in the db, so that it will clear out on the client's system?
      models.Op.create(dbOp)
        .then(function(output) {
          data.op.id = output.dataValues.id;
          self.pubRedis.publish('tytanic.op.' + data.op.objectId,
                                JSON.stringify(data.op));
          conn.write(JSON.stringify({
            messageType: 'opSuccess',
            op: data.op,
          }));
          resolve();
        })
        .error(function(e) {
          console.log(e);
          conn.write(JSON.stringify({
            messageType: 'opFail',
            op: data.op,
          }));
          resolve();
        });
      break;
    case 'subscribe':
      self.subscribe(conn, data.objectId);
      // TODO: if 'opId' is also passed in, we should send all ops since that one instead of (or in addition to) the ones since the snap.
      self.getSnapAndLogs(data.objectId).spread(function(snap, ops) {
        conn.write(JSON.stringify({
          messageType: 'snap',
          snap: cleanseSnap(snap),
        }));
        _.each(ops, function(op) {
          conn.write(JSON.stringify({
            messageType: 'op',
            op: op,
          }));
        });
        resolve();
      }).error(resolve); // TODO: errors shouldn't just resolve like this :/

      break;
    case 'unsubscribe':
      self.unsubscribe(conn, data.objectId);
      resolve();
      break;
    case 'takeSnapshot':
      self.createSnap(data.objectId).then(resolve);
      break;
    default:
      resolve();
    }
  });
};

Server.prototype.initNetwork = function() {
  var self = this;
  var sock = sockjs.createServer({ sockjs_url: 'http://cdn.jsdelivr.net/sockjs/1.0.1/sockjs.min.js' });
  sock.on('connection', function(conn) {
    conn.on('data', function(message) {
      console.log(message);
      self.receiveMessage(JSON.parse(message), conn);
    });
    conn.on('close', function() {
      self.closeConn(conn);
    });
  });

  var app = express();
  var server = http.createServer(app);
  sock.installHandlers(server, {prefix:'/sock'});

  app.get('/', function (req, res) {
    res.sendFile(path.resolve('index.html'));
  });
  app.get('/client.js', function (req, res) {
    res.sendFile(path.resolve('lib/client.js'));
  });
  app.get('/op.js', function (req, res) {
    res.sendFile(path.resolve('lib/op.js'));
  });

  server.listen(9999, '0.0.0.0');
};

Server.prototype.initRedis = function() {
  var self = this;
  this.subRedis = redis.createClient();
  this.subRedis.on('message', function(channel, message) {
    self.receiveRedisMessage(channel, message);
  });
  this.pubRedis = redis.createClient();
};

var models = {};
var sequelize;

function initDB(dbUrl) {
  if(sequelize) { // only initialize the db once!
    return new Promise(function(resolve, reject) {
      resolve();
    });
  }
  sequelize = new Sequelize(dbUrl);

  models.Op = sequelize.define('Op', {
    id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    objectId: Sequelize.BLOB('medium'),
    opName: Sequelize.BLOB('tiny'),
    args: Sequelize.BLOB('long'),
    clientNonce: Sequelize.BLOB('tiny'),
  }, {
    indexes: [
      { fields: ['objectId', 'id'] },
      { fields: ['clientNonce'], unique: true },
    ]
  });

  models.Snap = sequelize.define('Snap', {
    id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    objectId: Sequelize.BLOB('medium'),
    opId: {
      type: Sequelize.INTEGER,
      references: {
        model: models.Op,
        key: 'id',
      }
    },
    data: Sequelize.BLOB('long'),
  }, {
    indexes: [
      { fields: ['objectId', 'opId', 'id'] },
    ]
  });

  return sequelize.sync();
}

function run() {
  initDB('sqlite://.dev.sqlite').then(function() {
    var myServer = new Server();
    myServer.initRedis();
    myServer.initNetwork();
  });
}

module.exports = {
  cleanseOp: cleanseOp,
  cleanseSnap: cleanseSnap,
  initDB: initDB,
  models: models,
  Server: Server,
  run: run,
};
