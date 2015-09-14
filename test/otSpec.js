/*jshint node:true, mocha:true */
'use strict';

var expect = require('chai').expect;
var _ = require('lodash');

var ot = require('../lib/ot.js');

describe('ot', function() {

  describe('CommonOT', function() {

    describe('initialization', function() {
      it('initializes operation definitions', function() {
        var opDef = new ot.OpDef('example op', function(){});
        var cot = new ot.CommonOT([opDef]);
        expect(cot.opDefs['example op']).equal(opDef);
      });
    });

    describe('applyOp', function() {

      describe('create and delete', function() {
        it('creates and deletes', function() {
          var cot = new ot.CommonOT([]);
          cot.applyOp(new ot.Op('create', null, ['blah', {a:1}]));
          cot.applyOp(new ot.Op('create', null, ['hello']));
          expect(cot.database.blah).to.deep.equal({a:1});
          expect(cot.database.hello).to.deep.equal({});
          cot.applyOp(new ot.Op('delete', null, ['blah']));
          expect(cot.database.blah).to.equal(undefined);
          expect(cot.database.hello).to.deep.equal({});
        });
      });

      describe('altering op', function() {

        it('can alter objects', function() {
          var opDef = new ot.OpDef('example op', function(docs, args){
            docs[0].blah = args[0];
          });
          var cot = new ot.CommonOT([opDef]);
          cot.applyOp(new ot.Op('create', null, ['test']));
          cot.applyOp(new ot.Op('example op', ['test'], ['warglebargle']));
          expect(cot.database.test.blah).to.equal('warglebargle');
          cot.applyOp(new ot.Op('example op', ['test'], ['asdf']));
          expect(cot.database.test.blah).to.equal('asdf');
        });

        it('does nothing if an object is missing (e.g. was deleted)', function() {

        });
      });

    });

  });

  describe('ClientOT', function() {

    it('applies operations locally', function() {
      var opDef = new ot.OpDef('example op', function(docs, args){
        docs[0].blah = args[0];
      });
      var cot = new ot.ClientOT([opDef], 'myid');
      cot.run('create', null, ['test']);
      cot.run('example op', ['test'], ['asdf']);
      expect(cot.database.test.blah).to.equal('asdf');
      expect(cot.canonDatabase.test).to.equal(undefined);
    });

    it('applies server operations', function() {
      var opDef = new ot.OpDef('example op', function(docs, args){
        docs[0].blah = args[0];
      });
      var cot = new ot.ClientOT([opDef], 'myid');

      cot.receiveOps([new ot.Op('create', null, ['test']),
                      new ot.Op('example op', ['test'], ['asdf'])]);
      expect(cot.database.test.blah).to.equal('asdf');
      expect(cot.canonDatabase.test.blah).to.equal('asdf');
    });

    it('merges operations', function() {
      var opDef = new ot.OpDef('example op', function(docs, args){
        docs[0][args[0]] = args[1];
      });
      var cot = new ot.ClientOT([opDef], 'myid');
      cot.run('create', null, ['test']);
      cot.run('example op', ['test'], ['k2', 'v2']);
      expect(cot.database.test.k1).to.equal(undefined);
      expect(cot.database.test.k2).to.equal('v2');
      expect(cot.canonDatabase.test).to.equal(undefined);
      cot.receiveOps([new ot.Op('create', null, ['test']),
                      new ot.Op('example op', ['test'], ['k1', 'v1'])]);
      expect(cot.database.test.k1).to.equal('v1');
      expect(cot.database.test.k2).to.equal('v2');
      expect(cot.canonDatabase.test.k1).to.equal('v1');
      expect(cot.canonDatabase.test.k2).to.equal(undefined);
      cot.receiveOps(_.cloneDeep(cot.log));
      expect(cot.database.test.k1).to.equal('v1');
      expect(cot.database.test.k2).to.equal('v2');
      expect(cot.canonDatabase.test.k1).to.equal('v1');
      expect(cot.canonDatabase.test.k2).to.equal('v2');
      expect(cot.log).to.deep.equal([]);
      cot.receiveOps([new ot.Op('create', null, ['test2', {a:3}])]);
      expect(cot.database.test2).to.deep.equal({a:3});
    });

    it('sends operations to the server', function() {
      var sentOps = [];
      var sendFunc = function(op) {
        sentOps.push(op);
      };
      var cot = new ot.ClientOT([], 'myid', sendFunc);
      cot.run('create', null, ['test']);
      cot.run('create', null, ['test2']);
      expect(sentOps).to.deep.equal(cot.log);
    });

  });


  describe('ServerOT', function() {
    var opDef = new ot.OpDef('example op', function(docs, args){
      docs[0].blah = args[0];
    });
    var sot, cot1, cot2;
    var connect = function(cot, sot) {
      sot.addClient(cot.clientId, function(op) {
        cot.receiveOps([op]);
      });
    };
    beforeEach(function() {
      sot = new ot.ServerOT([opDef]);
      cot1 = new ot.ClientOT([opDef], 'id1', function(op) { sot.recvOp(op); });
      cot2 = new ot.ClientOT([opDef], 'id2', function(op) { sot.recvOp(op); });
      connect(cot1, sot);
      connect(cot2, sot);
    });

    it('syncs!', function() {
      cot1.run('create', null, ['test', {a:1}]);
      expect(cot1.database.test).to.deep.equal({a:1});
      expect(cot2.database.test).to.equal(undefined);
      expect(cot1.log).to.deep.equal([]);
      cot2.subscribe(['test']);
      expect(cot2.database.test).to.deep.equal({a:1});
      cot1.run('example op', ['test'], ['hello']);
      expect(cot1.database.test.blah).to.equal('hello');
      expect(cot2.database.test.blah).to.equal('hello');
      cot2.run('example op', ['test'], ['asdf']);
      expect(cot2.database.test.blah).to.equal('asdf');
      expect(cot1.database.test.blah).to.equal('asdf');
    });
  });
});
