# 02-cells-and-the-console.jl: how Julix runs code.
#   F5           runs the whole file
#   Ctrl Enter   runs the cell at the cursor (a cell starts at a line beginning with ##)
#   Shift Enter  runs the line at the cursor, or the selection
#   the console  runs an expression in the same session; ↑ recalls, Tab completes
# Errors point at this file and line, wherever the code ran from.

## A slow loop you can interrupt (Stop in the bar, or Ctrl C in the console)
total = 0.0
for k in 1:5
    global total += k^2
    println("step ", k, ": total = ", total)
    sleep(0.5)
end

## An error, to see where it points
f(x) = x > 2 ? error("x is too large: $x") : x
f(3)
