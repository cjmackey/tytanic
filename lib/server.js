/*jshint node:true */
'use strict';

var _ = require('lodash');
var express = require('express');
var sockjs = require('sockjs');
var Promise = require("bluebird");
var redis = require('redis');
var Sequelize = require('sequelize');

function Server() {
  this.blah = 'blah';
  this.subscriptions = {}; // objectId: {subscribers: {connId: conn}, lastId: int}
  this.connectionSubs = {}; // connId: {objectId: true}
  this.subRedis = null;
  this.pubRedis = null;
}

Server.prototype.subscribe = function(conn, objectId) {
  if(!this.subscriptions[objectId]) {
    this.subscriptions[objectId] = {subscribers: {}, lastId: -1};
    this.subRedis.subscribe('tytanic.ops.' + objectId);
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
    this.subRedis.unsubscribe('tytanic.ops.' + objectId);
  }
};

Server.prototype.closeConn = function(conn) {
  var self = this;
  _.each(this.connectionSubs[conn.id] || {}, function(t, objectId) {
    self.unsubscribe(conn, objectId);
  });
};

Server.prototype.receiveMessage = function(data, conn) {
  var self = this;
  return new Promise(function(resolve) {
    switch(data.messageType) {
    case 'op':
      models.Op.create(data.op)
        .then(function(output) {
          self.pubRedis.publish('tytanic.op.' + data.op.objectId,
                                JSON.stringify(output.dataValues.id));
          conn.write(JSON.stringify({
            messageType: 'opSuccess',
            op: data.op,
          }));
          resolve();
        })
        .error(function() {
          conn.write(JSON.stringify({
            messageType: 'opFail',
            op: data.op,
          }));
          resolve();
        });
      break;
    case 'subscribe':
      self.subscribe(conn, data.objectId);
      resolve();
      break;
    case 'unsubscribe':
      self.unsubscribe(conn, data.objectId);
      resolve();
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
      self.receiveMessage(JSON.parse(message), conn);
    });
    conn.on('close', function() {
      self.closeConn(conn);
    });
  });

  var app = express.createServer();
  sock.installHandlers(app, {prefix:'/sock'});

  app.get('/', function (req, res) {
    res.sendfile(__dirname + '/index.html');
  });

  app.listen(9999, '0.0.0.0');
};

Server.prototype.initRedis = function() {
  var self = this;
  this.redis = redis.createClient();
  this.redis.on('message', function(channel, message) {
    self.receiveRedisMessage(channel, message);
  });
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
      { fields: ['clientNonce'] },
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

module.exports = {
  initDB: initDB,
  models: models,
  Server: Server,
};
