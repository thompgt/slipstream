/**
 * Engine audio. Implemented in M6.
 *
 * Stacked sawtooth oscillators tracking RPM through a lowpass tracking throttle.
 * Synthesised rather than sampled because engine pitch varies continuously, and
 * crossfading pitch-shifted loops to hide stepping ends up being more code.
 *
 * Safari starts AudioContexts suspended until a user gesture — resume on the
 * click-to-start screen, which we want anyway for pointer lock.
 *
 * Timeboxed to one evening in M6: if it still sounds like a wasp in a jar, switch
 * to layered samples (STACK.md).
 */

export {}
