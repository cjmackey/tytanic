/*jshint node:true, mocha:true */
'use strict';

var expect = require('chai').expect;
var _ = require('lodash');
var sinon = require('sinon');

var server = require('../lib/server.js');

var sqliteDbUrl = 'sqlite://.test.sqlite';

var randomId, myServer;

describe('server', function() {
  beforeEach(function() {
    randomId = 'random id ' + Math.random();
  });

  describe('initDB', function() {
    it('should create tables i guess?', function(done) {
      server.initDB(sqliteDbUrl).then(function() {
        server.models.Op.create({objectId: randomId}).then(function() {
          server.models.Op.count({ where: ["objectId = ?", randomId] }).then(function(c) {
            expect(c).to.equal(1);
            done();
          });
        });
      });
    });
  });

  describe('with db initialized', function() {
    var conn;
    beforeEach(function(done) {
      myServer = new server.Server();
      conn = {write: sinon.spy(), id: 'blah'};
      myServer.pubRedis = {publish: sinon.spy()};
      myServer.subRedis = {subscribe: sinon.spy(), unsubscribe: sinon.spy()};
      server.initDB(sqliteDbUrl).then(done);
    });

    describe('receiveMessage', function() {

      it('receives an op message', function(done) {
        myServer.receiveMessage({
          messageType: 'op',
          op: {
            objectId: randomId,
          },
        }, conn).then(function() {
          server.models.Op.count({ where: ["objectId = ?", randomId] }).then(function(c) {
            expect(c).to.equal(1);
            done();
          });
        });
      });

      it('receives a subscribe message', function(done) {
        myServer.receiveMessage({
          messageType: 'subscribe',
          objectId: randomId,
        }, conn).then(function() {
          expect(myServer.subscriptions[randomId].subscribers[conn.id]).to.equal(conn);
          expect(myServer.connectionSubs[conn.id][randomId]).to.equal(true);
          expect(myServer.subRedis.subscribe.calledWith('tytanic.ops.' + randomId)).to.equal(true);
          done();
        });
      });

      it('receives an unsubscribe message', function(done) {
        myServer.receiveMessage({
          messageType: 'subscribe',
          objectId: randomId,
        }, conn).then(function() {
          console.log(myServer.connectionSubs);
          myServer.receiveMessage({
            messageType: 'unsubscribe',
            objectId: randomId,
          }, conn).then(function() {
            console.log(myServer.connectionSubs);
            expect(myServer.subscriptions[randomId]).to.equal(undefined);
            expect(myServer.connectionSubs[conn.id][randomId]).to.equal(undefined);
            expect(myServer.subRedis.unsubscribe.calledWith('tytanic.ops.' + randomId)).to.equal(true);
            done();
          });
        });
      });

    });
  });

});
