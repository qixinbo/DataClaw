from hatchling.builders.hooks.plugin.interface import BuildHookInterface
import os

class CustomHook(BuildHookInterface):
    def initialize(self, version, build_data):
        target = self.target_name
        force_include = build_data.setdefault("force_include", {})
        
        # Check if we are in original source tree or in an sdist
        is_sdist_build = os.path.exists(os.path.join(self.root, "PKG-INFO")) or os.path.exists(os.path.join(self.root, "frontend", "dist"))
        
        if is_sdist_build:
            frontend_dist = os.path.join(self.root, "frontend", "dist")
            nanobot_dir = os.path.join(self.root, "nanobot")
        else:
            frontend_dist = os.path.join(self.root, "..", "frontend", "dist")
            nanobot_dir = os.path.join(self.root, "..", "nanobot", "nanobot")
            
        main_py = os.path.join(self.root, "main.py")

        if target == "wheel":
            if os.path.exists(frontend_dist):
                force_include[frontend_dist] = "app/webui"
            if os.path.exists(nanobot_dir):
                force_include[nanobot_dir] = "nanobot"
            if os.path.exists(main_py):
                force_include[main_py] = "main.py"
                
        elif target == "sdist":
            # For sdist, we only pack them if we are in the original source tree
            if not is_sdist_build:
                if os.path.exists(frontend_dist):
                    force_include[frontend_dist] = "frontend/dist"
                if os.path.exists(nanobot_dir):
                    force_include[nanobot_dir] = "nanobot"
            if os.path.exists(main_py):
                force_include[main_py] = "main.py"
