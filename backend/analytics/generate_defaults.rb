#!/usr/bin/env ruby
require 'json'
puts JSON.pretty_generate({
  entry_trade_window_ms: 2500,
  crosshair_error_warning_deg: 4.0,
  utility_min_sample_rounds: 10,
  generated_by: 'Ruby MatchFrame analytics build step'
})
