patch_file = File.expand_path("_plugins/ruby_compatibility.rb", __dir__)
if File.exist?(patch_file) && !ENV["RUBYOPT"].to_s.include?("ruby_compatibility")
  ENV["RUBYOPT"] = "#{ENV['RUBYOPT']} -r#{patch_file}".strip
end
source "https://rubygems.org"

gem "github-pages", group: :jekyll_plugins
gem "jekyll-include-cache", group: :jekyll_plugins
gem "webrick", "~> 1.8"
gem 'csv'

gem "bigdecimal", "~> 4.1"
gem "base64", "~> 0.3.0"
gem "ostruct", "~> 0.6.3"

# --- Ruby 3.4 Compatibility Patch for older Liquid versions ---
unless Object.method_defined?(:tainted?)
  class Object
    def tainted?
      false
    end
  end
end
