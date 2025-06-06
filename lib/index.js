/* eslint-disable max-len */
/* eslint-disable no-console */
/* eslint-disable arrow-body-style */
/* eslint-disable padding-line-between-statements */
/* eslint-disable semi */
/* eslint-disable arrow-parens */
/* eslint-disable block-scoped-var */
/* eslint-disable no-redeclare */
/* eslint-disable one-var */
/* eslint-disable no-unused-vars */
var fs = require('fs'),
    path = require('path'),
    _ = require('lodash'),
    moment = require('moment-timezone'),
    handlebars = require('handlebars'),
    helpers = require('@budibase/handlebars-helpers')({
        handlebars: handlebars
    }),
    version = require('../package.json').version,
    chalk = require('chalk'),
    util = require('./util'),
    progress = require('cli-progress'),

    /**
 * An object of the default file read preferences.
 *
 * @type {Object}
 */
    FILE_READ_OPTIONS = { encoding: 'utf8' },

    /**
 * The default Handlebars template to use when no user specified template is provided.
 *
 * @type {String}
 */
    DEFAULT_TEMPLATE = 'dashboard-template.hbs',

    /**
    /**
 * The show only fails Handlebars template is used when the arg is passed in the cli.
 *
 * @type {String}
 */
    SHOW_ONLY_FAILS = 'only-failures-dashboard.hbs',

    /**
    /**
 * The list of execution data fields that are aggregated over multiple requests for the collection run
 *
 * @type {String[]}
 */
    AGGREGATED_FIELDS = ['cursor', 'item', 'request', 'response', 'requestError'],

    PostmanHTMLExtraReporter;

/**
 * A function that creates raw markup to be written to Newman HTML reports.
 *
 * @param {Object} newman - The collection run object, with a event handler setter, used to enable event wise reporting.
 * @param {Object} options - The set of HTML reporter run options.
 * @param {String} options.template - Optional path to the custom user defined HTML report template (Handlebars).
 * @param {String} options.export - Optional custom path to create the HTML report at.
 * @param {Object} collectionRunOptions - The set of all the collection run options.
 * @returns {*}
 */
PostmanHTMLExtraReporter = function (newman, options, collectionRunOptions) {
    // Helper for calculating pass percentage
    handlebars.registerHelper('percent', function (passed, failed) {
        return (passed * 100 / (passed + failed)).toFixed(0);
    });
    // Helper for converting object to json
    handlebars.registerHelper('formdata', function (context) {
        let formdata = {};

        context.forEach(function (value, key) {
            if (!value.disabled) {
                if (value.src) {
                    formdata[value.key] = value.src;
                }
                else {
                    formdata[value.key] = value.value;
                }
            }
        });

        return JSON.stringify(formdata);
    });

    // Helper for simple converting object to json when context.forEach returns empty value
    handlebars.registerHelper('object', function (context) {
        return JSON.stringify(context);
    });
    // increment helper for zero index
    handlebars.registerHelper('inc', function (value) {
        return parseInt(value) + 1;
    });
    // Sums the total tests by 'assertions - skipped tests'
    handlebars.registerHelper('totalTests', function (assertions, skippedTests) {
        return skippedTests ? parseInt(assertions) - parseInt(skippedTests) : parseInt(assertions);
    });
    // Adds the moment helper module
    handlebars.registerHelper('paging', function () {
        var paging = options.htmlextraTestPaging || false;

        return paging;
    });
    handlebars.registerHelper('logs', function () {
        var logs = options.htmlextraLogs || false;

        return logs;
    });
    handlebars.registerHelper('isTheSame', function (lvalue, rvalue, options) {
        if (arguments.length < 3) {
            throw new Error('Handlebars Helper equal needs 2 parameters');
        }
        // eslint-disable-next-line no-negated-condition
        // eslint-disable-next-line eqeqeq
        // eslint-disable-next-line no-negated-condition
        if (lvalue !== rvalue) {
            return options.inverse(this);
        }
        // eslint-disable-next-line no-else-return
        else {
            return options.fn(this);
        }
    });
    handlebars.registerHelper('isNotIn', function (elem, list, options) {
        if ((options.data.root.skipFolders === list &&
            options.data.root.skipFolders.length) ||
            (options.data.root.skipRequests === list &&
                options.data.root.skipRequests.length)) {
            // splits nested folder names fol1/fol2/fol3
            const convertedElemTemp = elem.split('/').map((elem) => elem.trim())
            const listTemp = list.split(',').map((elem) => elem.trim())
            const present = _.intersectionWith(listTemp, convertedElemTemp, _.isEqual);
            return present.length ? undefined : options.fn(this)
        }

        if (typeof (list) === 'object') {
            list = list.map(v => v.toLowerCase())
        }
        else if (list.length !== undefined) {
            list = list.toLowerCase()
        }

        if (elem === null) {
            return;
        }
        // eslint-disable-next-line lodash/prefer-is-nil
        if (elem !== undefined && elem !== null) {
            var convertedElem = elem.toLowerCase()
        }

        if (_.includes(list, convertedElem)) {
            return options.inverse(this);
        }

        return options.fn(this);
    });
    handlebars.registerHelper('totalFolders', function (aggregations) {
        return aggregations.length;
    });
    handlebars.registerHelper('totalFailedFolders', function (aggregations) {
        let failedFolders = 0;

        aggregations.forEach(aggregation => {
            aggregation.executions.forEach(execution => {
                if (execution.cumulativeTests.failed > 0) {
                    failedFolders++;
                }
            });
        });

        return failedFolders;
    });

    // @todo throw error here or simply don't catch them and it will show up as warning on newman
    if (options.htmlextraShowOnlyFails && !options.htmlextraTemplate) {
        var htmlTemplate = path.join(__dirname, SHOW_ONLY_FAILS);
    }
    else {
        // eslint-disable-next-line one-var
        // eslint-disable-next-line block-scoped-var
        var htmlTemplate = options.htmlextraTemplate || path.join(__dirname, DEFAULT_TEMPLATE);
    }
    var compiler = handlebars.compile(fs.readFileSync(htmlTemplate, FILE_READ_OPTIONS));
    // Handle the skipped tests

    newman.on('assertion', function (err, o) {
        if (err) { return; }

        if (o.skipped) {
            this.summary.skippedTests = this.summary.skippedTests || [];

            this.summary.skippedTests.push({
                cursor: {
                    ref: o.cursor.ref,
                    iteration: o.cursor.iteration,
                    scriptId: o.cursor.scriptId
                },
                assertion: o.assertion,
                skipped: o.skipped,
                error: o.error,
                item: {
                    id: o.item.id,
                    name: o.item.name
                }
            });
        }
    });
    if (options.htmlextraDisplayProgressBar) {
        // Add progress feedback for the reporter
        if (_.includes(collectionRunOptions.reporters, 'cli') || _.get(collectionRunOptions.reporter, 'cli') || _.includes(collectionRunOptions.reporters, 'json') || _.get(collectionRunOptions.reporter, 'json') || _.includes(collectionRunOptions.reporters, 'progress') || _.get(collectionRunOptions.reporter, 'progress')) {
            newman.on('start', function (err, o) {
                if (err) { return err; }
            });
        }
        if (!_.includes(collectionRunOptions.reporters, 'progress') && !_.get(collectionRunOptions.reporter, 'progress') && !_.includes(collectionRunOptions.reporters, 'cli') && !_.get(collectionRunOptions.reporter, 'cli') && !_.includes(collectionRunOptions.reporters, 'json') && !_.get(collectionRunOptions.reporter, 'json')) {
            var bar = new progress.Bar({
                format: 'Newman Run Progress |' + chalk.green('{bar}') + '| {percentage}% || Requests: {value}/{total} || ETA: {eta}s',
                barCompleteChar: '\u2588',
                barIncompleteChar: '\u2591',
                hideCursor: true
            });

            newman.on('start', function (err, o) {
                if (err) { return; }
                bar.start(o.cursor.length * o.cursor.cycles, 0);
            });

            newman.on('item', function () {
                bar.increment();
            });

            newman.on('done', function () {
                bar.stop();
            });
        }
    }

    newman.on('console', function (err, o) {
        if (err) { return; }

        if (options.htmlextraLogs) {
            this.summary.consoleLogs = this.summary.consoleLogs || {};
            this.summary.consoleLogs[o.cursor.ref] = this.summary.consoleLogs[o.cursor.ref] || [];
            this.summary.consoleLogs[o.cursor.ref].push(o);
        }
    });

    newman.on('beforeDone', function () {
        var items = {},
            executionMeans = {},
            netTestCounts = {},
            aggregations = [],
            traversedRequests = {},
            aggregatedExecutions = {},
            consoleLogs = this.summary.consoleLogs || {},
            executions = _.get(this, 'summary.run.executions'),
            assertions = _.transform(executions, function (result, currentExecution) {
                var stream,
                    reducedExecution,
                    executionId = currentExecution.cursor.ref;

                if (!_.has(traversedRequests, executionId)) {
                    // mark the current request instance as traversed
                    _.set(traversedRequests, executionId, 1);

                    // set the base assertion and cumulative test details for the current request instance
                    _.set(result, executionId, {});
                    _.set(netTestCounts, executionId, { passed: 0, failed: 0, skipped: 0 });

                    // set base values for overall response size and time values
                    _.set(executionMeans, executionId, { time: { sum: 0, count: 0 }, size: { sum: 0, count: 0 } });

                    reducedExecution = _.pick(currentExecution, AGGREGATED_FIELDS);

                    if (reducedExecution.response && _.isFunction(reducedExecution.response.toJSON)) {
                        reducedExecution.response = reducedExecution.response.toJSON();
                        stream = reducedExecution.response.stream;
                        reducedExecution.response.body = Buffer.from(stream).toString();
                    }

                    // set sample request and response details for the current request
                    items[reducedExecution.cursor.ref] = reducedExecution;
                }

                executionMeans[executionId].time.sum += _.get(currentExecution, 'response.responseTime', 0);
                executionMeans[executionId].size.sum += _.get(currentExecution, 'response.responseSize', 0);

                ++executionMeans[executionId].time.count;
                ++executionMeans[executionId].size.count;

                _.forEach(currentExecution.assertions, function (assertion) {
                    var aggregationResult,
                        assertionName = assertion.assertion,
                        testName = _.get(assertion, 'error.test') || undefined,
                        errorMessage = _.get(assertion, 'error.message') || undefined,
                        isError = _.get(assertion, 'error') !== undefined,
                        isSkipped = _.get(assertion, 'skipped');

                    result[executionId][assertionName] = result[executionId][assertionName] || {
                        name: assertionName,
                        testFailure: { test: testName, message: errorMessage },
                        passed: 0,
                        failed: 0,
                        skipped: 0
                    };
                    aggregationResult = result[executionId][assertionName];

                    if (isError && isSkipped !== true) {
                        aggregationResult.failed++;
                        netTestCounts[executionId].failed++;
                    }
                    else if (isSkipped) {
                        aggregationResult.skipped++;
                        netTestCounts[executionId].skipped++;
                    }
                    else if (isError === false && isSkipped === false) {
                        aggregationResult.passed++;
                        netTestCounts[executionId].passed++;
                    }
                });
            }, {}),

            aggregator = function (execution) {
                // fetch aggregated run times and response sizes for items, (0 for failed requests)
                var aggregationMean = executionMeans[execution.cursor.ref],
                    meanTime = _.get(aggregationMean, 'time', 0),
                    meanSize = _.get(aggregationMean, 'size', 0),
                    parent = execution.item.parent(),
                    iteration = execution.cursor.iteration,
                    previous = _.last(aggregations),
                    current = _.merge(items[execution.cursor.ref], {
                        assertions: _.values(assertions[execution.cursor.ref]),
                        mean: {
                            time: util.prettyms(meanTime.sum / meanTime.count),
                            size: util.filesize(meanSize.sum / meanSize.count)
                        },
                        cumulativeTests: netTestCounts[execution.cursor.ref],
                        consoleLogs: consoleLogs[execution.cursor.ref]
                    });

                current.testScripts = null;
                if (execution.item.events) {
                    current.testScripts = execution.item.events
                        .filter(e => e.listen === 'test')
                        .map(e => e.script.exec.join('\n'))
                }

                if (aggregatedExecutions[execution.cursor.ref]) { return; }

                aggregatedExecutions[execution.cursor.ref] = true;

                if (previous && parent.id === previous.parent.id && previous.parent.iteration === iteration) {
                    previous.executions.push(current);
                }
                else {
                    aggregations.push({
                        parent: {
                            id: parent.id,
                            name: parent.name,
                            description: parent.description,
                            iteration: iteration,
                            grandParents: util.getGrandParents(parent).reverse()
                        },
                        executions: [current]
                    });
                }
            };

        _.forEach(this.summary.run.executions, aggregator);

        // manually construct new node to support nested folder construction
        for (let i = 0; i < aggregations.length; i++) {
            const prev = i === 0 ? [] : aggregations[i - 1].parent.grandParents;
            const next = i === aggregations.length - 1 ? [] : aggregations[i + 1].parent.grandParents;
            const current = aggregations[i].parent.grandParents;
            const toStartFolder = _.differenceBy(current, prev, 'id');
            const toEndFolder = _.differenceBy(current, next, 'id');
            aggregations[i].parent.toStartFolder = toStartFolder;
            aggregations[i].parent.toEndFolder = toEndFolder;
        }

        //  File name validation regex from owasp https://owasp.org/www-community/OWASP_Validation_Regex_Repository
        var pattern = new RegExp('^(([a-zA-Z]:|\\\\)\\\\)?(((\\.)|' +
        '(\\.\\.)|([^\\\\/:*?"|<>. ](([^\\\\/:*?"|<>. ])|' +
        '([^\\\\/:*?"|<>]*[^\\\\/:*?"|<>. ]))?))' +
        '\\\\)*[^\\\\/:*?"|<>. ](([^\\\\/:*?"|<>. ])' +
        '|([^\\\\/:*?"|<>]*[^\\\\/:*?"|<>. ]))?$');

        let timezone = options.htmlextraTimezone || moment.tz.guess(true);

        this.exports.push({
            name: 'html-reporter-htmlextra-mz',
            default: (this.summary.collection.name).match(pattern) ?
                `${this.summary.collection.name}.html` : 'newman_htmlextra_mz.html',
            path: options.htmlextraExport,
            content: compiler({
                skipHeaders: options.htmlextraSkipHeaders || [],
                skipEnvironmentVars: options.htmlextraSkipEnvironmentVars || [],
                skipGlobalVars: options.htmlextraSkipGlobalVars || [],
                omitRequestBodies: options.htmlextraOmitRequestBodies || false,
                omitResponseBodies: options.htmlextraOmitResponseBodies || false,
                omitTestScript: options.htmlextraOmitTestScript || false,
                hideRequestBody: options.htmlextraHideRequestBody || [],
                hideResponseBody: options.htmlextraHideResponseBody || [],
                showEnvironmentData: options.htmlextraShowEnvironmentData || false,
                showGlobalData: options.htmlextraShowGlobalData || false,
                skipSensitiveData: options.htmlextraSkipSensitiveData || false,
                omitHeaders: options.htmlextraOmitHeaders || false,
                showMarkdownLinks: options.htmlextraShowMarkdownLinks || false,
                noSyntaxHighlighting: options.htmlextraNoSyntaxHighlighting || false,
                showFolderDescription: options.htmlextraShowFolderDescription || false,
                displayProgressBar: options.htmlextraSilentProgressBar || false,
                browserTitle: options.htmlextraBrowserTitle || 'Newman Summary Report',
                title: options.htmlextraTitle || 'Newman Run Dashboard',
                titleSize: options.htmlextraTitleSize || 2,
                timestamp: moment().tz(timezone).format('dddd, DD MMMM YYYY HH:mm:ss'),
                version: collectionRunOptions.newmanVersion,
                folders: collectionRunOptions.folder,
                skipFolders: options.htmlextraSkipFolders || [],
                skipRequests: options.htmlextraSkipRequests || [],
                aggregations: aggregations,
                summary: {
                    stats: this.summary.run.stats,
                    collection: this.summary.collection,
                    globals: _.isObject(this.summary.globals) ? this.summary.globals : undefined,
                    environment: _.isObject(this.summary.environment) ? this.summary.environment : undefined,
                    failures: this.summary.run.failures,
                    responseTotal: util.filesize(this.summary.run.transfers.responseTotal),
                    responseAverage: util.prettyms(this.summary.run.timings.responseAverage),
                    duration: util.prettyms(this.summary.run.timings.completed - this.summary.run.timings.started),
                    skippedTests: _.isObject(this.summary.skippedTests) ? this.summary.skippedTests : undefined
                }
            })
        });
    });
};

module.exports = PostmanHTMLExtraReporter;
