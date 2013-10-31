var check = require('check-types');
var q = require('q');
var _ = require('lodash');
var installModule = require('./module-install');
var reportSuccess = require('./report').reportSuccess;
var reportFailure = require('./report').reportFailure;

var cleanVersions = require('./registry').cleanVersions;
check.verify.fn(cleanVersions, 'cleanVersions should be a function');

var revertModules = require('./revert');
check.verify.fn(revertModules, 'revert is not a function, but ' +
    JSON.stringify(revertModules));

var npmTest = require('./npm-test').test;
var execTest = require('./exec-test');
var report = require('./report-available');

// expect array of objects, each {name, versions (Array) }
// returns promise
function testModulesVersions(options, available) {
    check.verify.object(options, 'missing options');
    check.verify.array(available, 'expected array of available modules');

    var cleaned = cleanVersions(options.modules);
    var listed = _.zipObject(cleaned);

    report(available);

    if (options.all) {
        var install = installAll(available);
        console.assert(install, 'could not get install all promise');
        var test = testPromise(options.command);
        console.assert(test, 'could not get test promise for command', options.command);
        console.dir(listed);
        console.dir(options.modules);
        var revert = revertModules.bind(null, listed);
        console.assert(revert, 'could not get revert promise');
        return install.then(test).then(revert);
    }

    return installEachTestRevert(listed, available, options.command, options.color);
}

// returns promise, does not revert
function installAll(available) {
    check.verify.array(available, 'expected array');

    var installFunctions = available.map(function (nameVersions) {
        var name = nameVersions.name;
        var version = nameVersions.versions[0];
        check.verify.string(name, 'missing module name from ' +
            JSON.stringify(nameVersions));
        check.verify.string(version, 'missing module version from ' +
            JSON.stringify(nameVersions));

        var installFunction = installModule.bind(null, name, version);
        return installFunction;
    });
    var installAllPromise = installFunctions.reduce(q.when, q());
    return installAllPromise;
}

function installEachTestRevert(listed, available, command, color) {
    check.verify.object(listed, 'expected listed object');
    check.verify.array(available, 'expected array');

    var checkModulesFunctions = available.map(function (nameVersion) {
        var name = nameVersion.name;
        var currentVersion = listed[name];
        check.verify.string(currentVersion, 'cannot find current version for ' + name +
            ' among current dependencies ' + JSON.stringify(listed));

        var revertFunction = installModule.bind(null, name, currentVersion);
        var checkModuleFunction = testModuleVersions.bind(null, {
            moduleVersions: nameVersion,
            revertFunction: revertFunction,
            command: command,
            color: color
        });
        return checkModuleFunction;
    });
    var checkAllPromise = checkModulesFunctions.reduce(q.when, q());
    return checkAllPromise;
}

// test particular dependency with multiple versions
// returns promise
function testModuleVersions(options, results) {
    check.verify.object(options, 'missing options');
    var nameVersions = options.moduleVersions;
    var restoreVersionFunc = options.revertFunction;

    var name = nameVersions.name;
    var versions = nameVersions.versions;
    check.verify.string(name, 'expected name string');
    check.verify.array(versions, 'expected versions array');
    results = results || [];
    check.verify.array(results, 'expected results array');

    var deferred = q.defer();
    var checkPromises = versions.map(function (version) {
        return testModuleVersion.bind(null, {
            name: name,
            version: version,
            command: options.command,
            color: options.color
        });
    });
    var checkAllPromise = checkPromises.reduce(q.when, q());
    checkAllPromise
    .then(restoreVersionFunc)
    .then(function (result) {
        results.push(result);
        deferred.resolve(results);
    }, function (error) {
        console.error('could not check', nameVersions, error);
        deferred.reject(error);
    });

    return deferred.promise;
}

// checks specific module@version
// returns promise
function testModuleVersion(options, results) {
    check.verify.object(options, 'missing test module options');
    check.verify.string(options.name, 'missing module name');
    check.verify.string(options.version, 'missing version string');

    if (options.command) {
        check.verify.string(options.command, 'expected command string');
    }
    // console.log('options', options);

    results = results || [];
    check.verify.array(results, 'missing previous results array');

    var nameVersion = options.name + '@' + options.version;
    console.log('\ntesting', nameVersion);

    var result = {
        name: options.name,
        version: options.version,
        works: true
    };

    var test = testPromise(options.command);
    console.assert(test, 'could not get test promise for command', options.command);

    var deferred = q.defer();
    var installPromise = installModule(options.name, options.version);
    installPromise.then(test).then(function () {
        reportSuccess(nameVersion + ' works', options.color);
        results.push(result);
        deferred.resolve(results);
    }, function (error) {
        reportFailure(nameVersion + ' tests failed :(', options.color);
        console.error(error);
        result.works = false;
        results.push(result);
        deferred.resolve(results);
    });
    return deferred.promise;
}

function testPromise(command) {
    var testFunction = npmTest;
    if (command) {
        check.verify.string(command, 'expected string command, not ' + command);
        testFunction = execTest.bind(null, command);
    }
    return testFunction;
}

module.exports = {
    testModulesVersions: testModulesVersions,
    testModuleVersion: testModuleVersion
};
