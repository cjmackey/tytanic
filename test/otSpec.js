'use strict';

var expect = require('chai').expect;

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
});
