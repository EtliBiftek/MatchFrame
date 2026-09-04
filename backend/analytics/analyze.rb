#!/usr/bin/env ruby
require 'json'

raw = STDIN.read
input = JSON.parse(raw.empty? ? '{}' : raw) rescue {}
metrics = input.fetch('metrics', {})
notes = []

if metrics['entry_deaths'].to_i > metrics['entry_traded'].to_i * 2
  notes << { severity: 'high', tag: 'entry', text: 'Entry deaths are frequently going untraded.' }
end
if metrics['avg_crosshair_error_deg'].to_f > 4.0
  notes << { severity: 'medium', tag: 'aim', text: 'Crosshair placement error is above the initial MatchFrame target.' }
end
if metrics['flash_assists'].to_i == 0 && metrics['rounds'].to_i >= 10
  notes << { severity: 'low', tag: 'utility', text: 'No flash assists detected in the analysed sample.' }
end

puts JSON.generate({ engine: 'ruby-rules-v1', notes: notes })
