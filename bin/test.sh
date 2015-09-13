#!/bin/bash

time ./node_modules/jshint/bin/jshint lib/ test/ && time ./node_modules/mocha/bin/mocha && time ./node_modules/mocha/bin/mocha --require blanket -R html-cov > coverage.html
