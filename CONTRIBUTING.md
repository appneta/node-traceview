# Contributing

## Setting up the dev environment

The dev environments for [traceview](https://github.com/appneta/node-traceview)
and [traceview-bindings](https://github.com/appneta/node-traceview-bindings)
consist of a [vagrant](https://www.vagrantup.com/) virtual machine with
liboboe/tracelyzer and latest stable version of node installed. It reports
to the [stephenappneta](http://stephenappneta.tv.appneta.com) organization.

The traceview `Vagrantfile` also includes a collection of docker containers,
defined in the `docker-containers.json` file. Note that, while this is intended
to be run using the vagrant docker configuration, I've also included a file
named `docker.rb` which allows the container list to be set up directly on any
system with docker already installed.

### Pointing to QA supporting services

In the event that you need to point tests at the QA support service databases,
you can configure the environment variables set in the `Vagrantfile` and
rebuild the container.

## Running the test suite

The full test suite can be run inside `/vagrant` on the virtual machine using
`gulp test`. You can also run the API unit tests with `gulp test:unit` or run
the probe integration tests with `gulp test:probes`. If you want to run the
tests for a specific module, you can do that too by running
`gulp test:probe:${module}`.

## Running the support matrix test suite

The support matrix test suite runs the tests for a given module against every
supported version of that module, down to patch releases. Note that this can
take a *very* long time!

You can run the full support matrix test suite with `gulp support-matrix`,
but generally you are better off scoping to a module by simply running
`gulp support-matrix:${module}`

## Running the test suite with code coverage analysis

Any test task can be run with code coverage analysis by simply replacing the
`test:` prefix with `coverage:`. Note that coverage from the full test suite
will show the best coverage numbers because subsections of the test suite may
not exercise particular areas. It's useful to be able to do subsection analysis
though, as it can help to spot areas that *should* be exercised, but are not.

## Running the benchmark suite

Similar to the test suite running options, there are also `gulp bench`,
`gulp bench:unit`, `gulp bench:probes` and numerous `gulp bench:probe:*` tasks.

## Generating the docs

The repo includes code comment based API docs, which can be generated with
`gulp docs`.

## Build process

The code is written in ES6 and uses [Babel](http://babeljs.io) to transpile it
for old node versions. You can trigger this build manually with `gulp build`.
However, the build task gets triggered automatically by any test, benchmark,
coverage, or support-matrix task and is also included as a prepublish step in
`package.json`, so you should probably never need to trigger it yourself.

## Development process

The development process thus far has involved maintaining separate feature
branches that get rebased from master before a squash or merge to master,
depending on complexity (ie: need to keep commits separate).

## Release process

When you are ready to release, rebase your branches off master, run the tests,
then merge to master and repeat for subsequent branches. When all the things
planned for release have been merged to master, create a version bump commit.
I've used `npm version patch|minor|major` for this, but it can be done manually
if you prefer.

After the version bump commit has been made, make sure it is tagged and push the
commit and tags to git. Note that `npm version *` creates the tag itself, so
you can skip that step if you use it.

After all commits and tags have been pushed to git, it's simply a matter of
running `npm publish` to send the latest version to the npm registry.
