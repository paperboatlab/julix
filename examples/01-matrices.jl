# 01-matrices.jl: matrices and linear algebra, with the standard library only.
# Run it all (F5), or one cell at a time: put the cursor in a cell and press Ctrl Enter.
# Every name you define appears under Variables; the console (Ctrl J) works on the same session.

## Build some matrices
using LinearAlgebra
A = [4.0 1 0; 1 3 1; 0 1 2]          # a symmetric 3 × 3 matrix
b = [1.0, 2, 3]
I3 = Matrix(I, 3, 3)                 # the identity

## Solve and check
x = A \ b                            # solves A x = b
residual = norm(A * x - b)

## Eigenvalues
λ, V = eigen(A)                      # A V = V Λ
λ
