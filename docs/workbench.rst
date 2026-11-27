Workbench
=========

The window: the file tree, the editor, the console, the variables and the figures.

Files
-----

.. note:: Not written yet: the tree, new and rename, the trash, the examples.

Editor
------

.. note:: Not written yet: cells (``##``), running a script, a cell or a line, errors in the margin.

Console
-------

.. note:: Not written yet: history, multi-line input, interrupting a run.

Variables
---------

.. note:: Not written yet: the session's variables, how they update after a run.

**Shared with Simplicial.** While a Simplicial station runs on this computer, the session's variables
go to it after every run: numbers, booleans, text (one line), and real arrays as a matrix by its rows
(a vector is a column), up to 4096 values; a larger array goes as its size only, so share a slice. In
Simplicial they show under **From Julix** in the Variables card, and a block's setting can be bound to
one; a variable the flow defines itself wins. They go when Julix closes or its session restarts.

Folders and hubs
----------------

Julix works in one place at a time: a folder on this computer, or a hub (with Malachite installed). With
none, the **Start** page fills the window: Open folder…, Open file…, New script, Connect to a hub…, and
the folders, hubs and scripts you opened lately. The list is shared: the other Paperboat apps show the
same folders and hubs, and each its own files.

The **File** menu is the same in every app: New script, Open file…, Open folder…, Open recent, Connect to
a hub…, Save, Save as…, Close file, Close folder, Settings…. The well after the menu bar names the folder
or the hub; its menu opens another, connects, or closes it (back to Start).

- **Open file…** in a folder asks first, when you have hubs: a local file, or connect to a hub. A script
  from outside the folder brings its folder (or its hub, when it lies in one) along.
- **In a hub**, Open file… and Save as… show Julix's own picker over the hub, never the system's; the
  hub's menu switches to another hub, makes a new one, opens it in Malachite, or goes back to a local
  folder (**Use a local folder instead…**). **Close hub** goes back to Start. Only Julix switches; the
  other apps stay where they are.
- **In a Paperboat window** the system's dialogs pick files and folders. In a browser, type the path;
  Save as… downloads the script.
- Closing a script with changes not yet saved asks: Save, Don't save, or Cancel.

The theme is shared too: what you choose in one app is the theme every app starts in. Without Malachite,
Julix says nothing about hubs.

Settings
--------

**File › Settings…** (:kbd:`Ctrl ,`) opens one window with its pages on the left; a change applies at
once, there is no Save.

- **General**: the theme, Light, Dark or System (it follows the computer). It applies to every Paperboat
  app; **View › Theme** lists the same three.
- **Julix**: the Julia it runs on (Paperboat's Julia runtime; a session starts for each folder) and the
  project, which is the folder itself. Julix adds JulixPlot to it before the folder's first session; every
  other package is added and removed in Paperboat Launcher › **Runtimes** › **julia** › **Packages**, the
  one package manager for Julia (choose the folder there as the project).
- **Editor**: the code's colours, font, size and line height; tab size, wrapping, autocomplete, closing
  brackets and lint (Julia's parser).
- **Hub**, while Julix works in a hub: its name and folder, **Switch hub…** and **Close hub**. The hub's
  own settings (its author, how long it keeps versions) are set in Malachite.
- **Shortcuts**: every key Julix answers, by menu. **Help › Keyboard shortcuts** (:kbd:`Ctrl /`) opens
  this page; in the script :kbd:`Ctrl /` comments the lines instead.

Keyboard shortcuts
------------------

.. list-table::
   :header-rows: 1

   * - Key
     - Does
   * - :kbd:`F5`
     - Run the script
   * - :kbd:`Ctrl Enter`
     - Run the cell at the cursor
   * - :kbd:`Shift Enter`
     - Run the line
   * - :kbd:`Ctrl N`
     - New script
   * - :kbd:`Ctrl O`
     - Open file…
   * - :kbd:`Ctrl Shift O`
     - Open folder…
   * - :kbd:`Ctrl S`
     - Save
   * - :kbd:`Ctrl Shift S`
     - Save as…
   * - :kbd:`Ctrl W`
     - Close the script (in a Paperboat window; a browser keeps the key)
   * - :kbd:`Ctrl K`
     - Search the folder, or run a command
   * - :kbd:`Ctrl ,`
     - Settings
   * - :kbd:`Ctrl /`
     - Keyboard shortcuts (Settings › Shortcuts lists them all); in the script, comment the lines
