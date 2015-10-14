/*jshint node:true, mocha:true */
'use strict';

var expect = require('chai').expect;
var _ = require('lodash');
var sinon = require('sinon');

var client = require('../lib/client.js');


var randomId, myClient, fauxLocalStorage;

describe('client', function() {
  beforeEach(function() {
    fauxLocalStorage = {
      getItem: function(key) { return fauxLocalStorage[key]; },
      setItem: function(key, val) { fauxLocalStorage[key] = val; },
      removeItem: function(key) { delete fauxLocalStorage[key]; },
    };
    randomId = 'random id ' + Math.random();
    myClient = new client.Client({localStorage: fauxLocalStorage});
    myClient.send = sinon.spy();
  });

  describe('op', function() {
    it('adds an operation to opDefs', function() {
      expect(myClient.opDefs.definitions.asdf).to.equal(undefined);
      var f = function(){};
      myClient.op('asdf', f);
      expect(myClient.opDefs.definitions.asdf).to.equal(f);
    });
  });

  describe('run', function() {

    it('works locally', function() {
      expect(myClient.objects.asdf).to.equal(undefined);
      myClient.run('set', 'asdf', ['k', 'v']);
      expect(myClient.objects.asdf.k).to.equal('v');
    });

  });

  describe('receiveOp', function() {
    it('applies the op in a simple case...', function() {
      expect(myClient.objects.asdf).to.equal(undefined);
      myClient.receiveOp({
        id: 23,
        objectId: 'asdf',
        clientNonce: 'garbledygook',
        opName: 'set',
        args: ['k', 'v'],
      });
      expect(myClient.objects.asdf.k).to.equal('v');
    });
  });

  describe('receiveSnap', function() {
    it('sets the snap in a simple case...', function() {
      expect(myClient.objects.asdf).to.equal(undefined);
      myClient.receiveSnap({
        id: 12,
        opId: 23,
        objectId: 'asdf',
        data: {k: 'v'},
      });
      expect(myClient.objects.asdf.k).to.equal('v');
    });
  });

  describe('subscribe', function() {
    it('sends a subscribe message, and remembers that we are subscribed', function() {
      myClient.subscribe('asdf');
      expect(myClient.send.args).to.deep.equal([[{
        messageType: 'subscribe',
        objectId: 'asdf',
        opId: null,
      }]]);
      expect(fauxLocalStorage['tytanic.subscriptions.asdf']).to.equal(true);
    });
  });

});
