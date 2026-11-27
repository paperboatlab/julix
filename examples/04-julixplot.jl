# 04-julixplot.jl: a figure you can pan, zoom and orbit. Needs JulixPlot in this folder: Julix adds it
# before the folder's first session (once; Julia downloads it for that step only).
# 2D axes pan (drag), zoom (wheel, or a box), read values (hover), compare two cursors (A/B);
# the 3D axis orbits (drag), zooms (wheel) and snaps to a side from its view cube.

## Data: a first-order step response, measured with noise
using JulixPlot
t = range(0, 60; length = 300)
step(K, τ) = K .* (1 .- exp.(-max.(t .- 5, 0) ./ τ))
h = step(4.97, 14.2) .+ 0.05 .* randn(length(t))

## The fit and its cost surface
J(K, τ) = sum(abs2, h .- step(K, τ))
Ks = range(3, 7; length = 40)
τs = range(8, 30; length = 40)
C = [J(K, τ) for K in Ks, τ in τs]
K̂, τ̂ = Ks[argmin(C)[1]], τs[argmin(C)[2]]

## The figure
fig = Figure(; size = (900, 680))
ax1 = Axis(fig[1, 1:2]; title = "Step at 5 cm", xlabel = "t [s]", ylabel = "level [cm]")
scatter!(ax1, t, h; label = "measured", markersize = 4)
lines!(ax1, t, step(K̂, τ̂); label = "fit", linewidth = 2)
axislegend(ax1; position = :rb)
ax2 = Axis(fig[2, 1]; title = "residual", xlabel = "t [s]")
lines!(ax2, t, h .- step(K̂, τ̂))
ax3 = Axis3(fig[2, 2]; title = "J(K, τ)", xlabel = "K", ylabel = "τ")
surface!(ax3, Ks, τs, log.(C); colormap = :viridis)
fig
