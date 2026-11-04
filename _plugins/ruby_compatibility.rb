# Ruby 3.4 compatibility patch for Liquid 4.0.3 (used by github-pages)
unless Object.method_defined?(:tainted?)
  class Object
    def tainted?
      false
    end

    def taint
      self
    end

    def untaint
      self
    end
  end
end

