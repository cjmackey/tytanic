#!/bin/bash

mkdir -p coverage

time ./node_modules/jshint/bin/jshint lib/ test/ && time ./node_modules/mocha/bin/mocha && time ./node_modules/mocha/bin/mocha --require blanket -R html-cov > coverage/coverage.html || exit 1
