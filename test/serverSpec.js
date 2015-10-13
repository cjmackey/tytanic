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
    beforeEach(function(done) {
      myServer = new server.Server();
      server.initDB(sqliteDbUrl).then(done);
    });

    describe('receiveMessage', function() {
      var conn;
      beforeEach(function(done) {
        conn = {write: sinon.spy()};
        myServer.pubRedis = {publish: sinon.spy()};
        done();
      });

      it('receives an op message', function(done) {
        myServer.receiveMessage({
          messageType: 'op',
          op: {
            objectId: randomId,
          },
        }, conn)
          .then(function() {
            server.models.Op.count({ where: ["objectId = ?", randomId] }).then(function(c) {
              expect(c).to.equal(1);
              done();
            });
          });
      });
    });
  });

});
