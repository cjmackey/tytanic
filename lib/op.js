/*jshint node:true */
'use strict';

if(typeof require !== 'undefined'){
  var _ = require('lodash');
}

var tytanic = tytanic || {};

tytanic.op = {};

if(typeof module !== 'undefined') {
  module.exports = tytanic.op;
}

tytanic.op.OpDefs = function() {
  this.definitions = {
    set: function(path, value) {
      _.set(this, path, value);
    }
  };
};

tytanic.op.OpDefs.prototype.op = function(opName, func) {
  this.definitions[opName] = func;
};

tytanic.op.OpDefs.prototype.run = function(opName, object, args) {
  try {
    this.definitions[opName].apply(object, args);
  } catch (e) {
    // we can log errors if we want, but the show must go on.
  }
};
