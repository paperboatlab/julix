Getting started
===============

Install and open it with the Paperboat CLI (or the Launcher's Apps page). Installing pulls the Julia
runtime too.

.. code-block:: sh

   paperboat app install julix
   paperboat app open julix [<folder>]      # http://127.0.0.1:30473; no folder: the Start page
   paperboat app stop julix

Your first script
-----------------

- Open a ``.jl`` from **Files**, or make a new one.
- :kbd:`F5` runs the script, :kbd:`Ctrl Enter` the cell at the cursor (a cell starts at a ``##``
  line), :kbd:`Shift Enter` the line.
- The console runs an expression in the same session.

.. note:: Not written yet: a first script end to end, with a screenshot.

The folder
----------

Julix opens a folder of ``.jl`` scripts, or a hub. Without
a folder it opens on the Start page; **File › Open folder…** (:kbd:`Ctrl Shift O`) picks one
and switches at any time, without a restart. ``/?open=<path>`` opens a file: a path in the folder, or a
whole path, which brings its folder along.

.. note:: Not written yet: what the session can see outside the folder.

The examples
------------

The examples open from the command search: press :kbd:`Ctrl K`, type ``example``, and pick
**Open example: <name>**. Julix asks Paperboat for them (``paperboat example list --app julix``); opening one
opens it where it is, in a new window. A line at the top says it is an example: run it as it is, or click
**copy it to <folder>** to change it. The copy goes into the folder you opened the example from (with no folder
open, Julix asks where) and opens in its own window. An example from GitHub is a copy Paperboat replaces after a
day, so changes there aren't kept. Without Paperboat there are none.
