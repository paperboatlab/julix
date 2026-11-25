Getting started
===============

Install and open it with the Paperboat CLI (or the Launcher's Apps page). Installing pulls the Julia
runtime too.

.. code-block:: sh

   paperboat app install julix
   paperboat app open julix [<folder>]      # http://127.0.0.1:30473
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

Julix opens a folder of ``.jl`` scripts. The read-only examples are shown in every folder.
``/?open=<path>`` opens a file.

.. note:: Not written yet: the default folder, and what the session can see outside it.
