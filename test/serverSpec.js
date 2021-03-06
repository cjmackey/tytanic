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

    describe('getSnap', function() {

      it('returns an empty snap if there are none', function(done) {
        myServer.getSnap(randomId).then(function(snap) {
          expect(snap.opId).to.equal(null);
          expect(snap.data).to.deep.equal({});
          done();
        });
      });

      it('returns the latest snap if there is one', function(done) {
        var snap = {objectId: randomId, opId: 1, data: JSON.stringify({a: 1})};
        server.models.Snap.create(snap).then(function() {
          snap = {objectId: randomId, opId: 1, data: JSON.stringify({a: 2})};
          server.models.Snap.create(snap).then(function() {
            myServer.getSnap(randomId).then(function(snap) {
              console.log(snap);
              expect(snap.opId).to.equal(1);
              expect(snap.data).to.deep.equal({a: 2});
              done();
            });
          });
        });
      });

    });

    describe('createSnap', function() {

      it('if there is nothing, it creates an empty snapshot', function(done) {
        myServer.createSnap(randomId).then(function(snap) {
          expect(snap.data).to.deep.equal({});
          expect(snap.opId).to.equal(null);
          done();
        });
      });

      // TODO: add more tests!
      // if there are ops, but no snaps
      // if there is a snap, but no ops
      // if there are both snaps and ops

    });

    describe('getSnapAndLogs', function() {

      it('gets ops in the case where there is no snapshot', function(done) {
        server.models.Op.create({objectId: randomId, opName: 'asdf'}).then(function() {
          myServer.getSnapAndLogs(randomId).spread(function(snap, ops) {
            expect(ops.length).to.equal(1);
            expect(ops[0].opName.toString()).to.equal('asdf');
            done();
          });
        });
      });

      // TODO: create a snapshot, then do it
    });

    describe('receiveRedisMessage', function() {

      it('updates subscribers with op', function(done) {
        myServer.receiveMessage({
          messageType: 'subscribe',
          objectId: randomId,
        }, conn).then(function() {
          server.models.Op.create({objectId: randomId, args: JSON.stringify(['asdf', 'blah'])}).then(function(result) {
            var opId = result.dataValues.id;
            var op = result.dataValues;
            server.cleanseOp(op);
            myServer.receiveRedisMessage('tytanic.op.' + randomId, JSON.stringify(op)).then(function() {
              var expectedMessage = {
                messageType: 'op',
                op: {
                  id: opId,
                  objectId: randomId,
                  opName: '',
                  args: ["asdf","blah"],
                  clientNonce: '',
                }
              };
              expect(JSON.parse(conn.write.args[1][0])).to.deep.equal(expectedMessage);
              done();
            });
          });
        });
      });

      it('updates subscribers with snap', function(done) {
        myServer.receiveMessage({
          messageType: 'subscribe',
          objectId: randomId,
        }, conn).then(function() {
          server.models.Op.create({
            objectId: randomId,
            opName: 'set',
            args: JSON.stringify(['asdf', 'blah'])
          }).then(function(result) {
            myServer.createSnap(randomId).then(function(snap) {
              myServer.receiveRedisMessage('tytanic.snap.' + randomId, JSON.stringify(snap)).then(function() {
                var expectedMessage = {
                  messageType: 'snap',
                  snap: server.cleanseSnap(snap),
                };
                console.log(expectedMessage);
                console.log(JSON.parse(conn.write.args[1][0]));
                expect(JSON.parse(conn.write.args[1][0])).to.deep.equal(expectedMessage);
                done();
              });
            });
          });
        });
      });

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

      it('receives a subscribe message, adds the connection to the list of subscribers, and sends back the recent snap and logs', function(done) {
        myServer.receiveMessage({
          messageType: 'subscribe',
          objectId: randomId,
        }, conn).then(function() {
          expect(myServer.subscriptions[randomId].subscribers[conn.id]).to.equal(conn);
          expect(myServer.connectionSubs[conn.id][randomId]).to.equal(true);
          expect(myServer.subRedis.subscribe.calledWith('tytanic.op.' + randomId)).to.equal(true);
          var expected = {
            messageType: 'snap',
            snap: {
              objectId:randomId,
              opId: null,
              data:{}
            },
          };
          console.log(conn.write.args);
          console.log(expected);
          expect(conn.write.calledWith(JSON.stringify(expected))).to.equal(true);
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
            expect(myServer.subRedis.unsubscribe.calledWith('tytanic.op.' + randomId)).to.equal(true);
            done();
          });
        });
      });

    });
  });

});
