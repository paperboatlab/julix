# The e2e's figure script: a type that shows itself as SVG; two display() calls are two figures,
# and the last value (a loop) is nothing. K and h are the variables the test reads back.
struct Line
    y::Vector{Float64}
end
Base.show(io::IO, ::MIME"image/svg+xml", l::Line) = print(io, """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>$(length(l.y))</text></svg>""")

t = range(0, 60; length = 200)
K = 4.97
h = @. K * (1 - exp(-max(t - 5, 0) / 14.2))
for τ in (5.0, 20.0)
    display(Line(@. K * (1 - exp(-max(t - 5, 0) / τ))))
end
