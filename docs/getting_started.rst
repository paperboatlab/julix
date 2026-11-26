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

Julix opens a folder of ``.jl`` scripts, or a hub; the read-only examples are shown in every one. Without
a folder it opens on the Start page; **File › Open folder…** (:kbd:`Ctrl Shift O`) picks one
and switches at any time, without a restart. ``/?open=<path>`` opens a file: a path in the folder, or a
whole path, which brings its folder along.

.. note:: Not written yet: what the session can see outside the folder.
