module.exports = function (grunt) {

  // Project configuration.
  grunt.initConfig({
    qunit: {
      all: {
        options: {
          urls: [
            'http://localhost:8000/test/test-history.html'
          ],
          force: true
        }
      }
    },
    connect: {
      server: {
        options: {
          port: 8000,
          base: '.'
        }
      }
    },
    bower: {
      install: {
        options: {
          targetDir: './test/lib',
          cleanup: true
        }
      }
    },
    watch: {
      scripts: {
        files: [
          'history.js',
          'test/test-history.html',
          'test/test-history.js'
        ],
        tasks: ['qunit']
      }
    }

  });

  grunt.loadNpmTasks('grunt-contrib-qunit');
  grunt.loadNpmTasks('grunt-contrib-connect');
  grunt.loadNpmTasks('grunt-bower-task');
  grunt.loadNpmTasks('grunt-contrib-watch');

  grunt.registerTask('test', ['bower:install', 'connect', 'qunit']);
  grunt.registerTask('default', ['test']);

  grunt.event.on('qunit.log',
    function (result, actual, expected, message) {
      if (!!result) {
        grunt.log.ok(message);
      }
    });
};
