# 03-figures.jl: anything that shows itself as SVG or PNG becomes a figure.
# Plots.jl and CairoMakie do (add them in the console: import Pkg; Pkg.add("Plots")). This example
# needs no package: a small type draws itself as SVG, so you can see how figures arrive.

## A type that draws itself
struct Line
    x::Vector{Float64}
    y::Vector{Float64}
    title::String
end

function Base.show(io::IO, ::MIME"image/svg+xml", l::Line)
    w, h, m = 480, 300, 40
    sx(v) = m + (v - minimum(l.x)) / (maximum(l.x) - minimum(l.x)) * (w - 2m)
    sy(v) = h - m - (v - minimum(l.y)) / (maximum(l.y) - minimum(l.y)) * (h - 2m)
    pts = join(("$(round(sx(a); digits=1)),$(round(sy(b); digits=1))" for (a, b) in zip(l.x, l.y)), " ")
    print(io, """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 $w $h" width="$w" height="$h">
      <rect width="$w" height="$h" fill="#0d0d0d"/>
      <path d="M$m $m V$(h - m) H$(w - m)" stroke="#555" fill="none"/>
      <text x="$(w ÷ 2)" y="24" fill="#eee" font-family="sans-serif" font-size="14" text-anchor="middle">$(l.title)</text>
      <polyline points="$pts" fill="none" stroke="#cdbbf6" stroke-width="2"/>
    </svg>""")
end

## A step response, as a figure: run this cell alone (Ctrl Enter); its last value is shown
t = range(0, 60; length = 200)
K, τ = 4.97, 14.2
h = @. K * (1 - exp(-max(t - 5, 0) / τ))
Line(collect(t), h, "Step response: K = $K, τ = $τ s")

## display() makes a figure too, mid-script
for τ in (5.0, 20.0)
    display(Line(collect(t), (@. K * (1 - exp(-max(t - 5, 0) / τ))), "τ = $τ s"))
end
