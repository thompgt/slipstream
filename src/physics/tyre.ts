/**
 * Tyre force model. Implemented in M1.
 *
 * This file is where "grippy but slidey, rewards trail braking" actually lives:
 * grip rises to a peak slip angle, then falls away *gently* rather than snapping,
 * so a slide can be caught. Being a plain function of slip angle — rather than an
 * emergent property of a constraint solver — is the whole reason physics is
 * hand-rolled here (STACK.md).
 */

export {}
