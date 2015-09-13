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
          cot.applyOp(new ot.Op('create', null, ['blah', 'hello']));
          expect(cot.database.blah).to.deep.equal({});
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
    });

  });

});
