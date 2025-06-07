import sys

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python yaml_to_production.py <path_to_yaml_file> <output_yaml_file>")
        sys.exit(1)

    yaml_file_path = sys.argv[1]
    output_yaml_path = sys.argv[2]

    try:
        with open(yaml_file_path, 'r') as file:
            content = file.read()
            content = content.replace('__dev', '').replace('staging.botnim', 'www.botnim')
        with open(output_yaml_path, 'w') as output_file:
            output_file.write(content)
    except FileNotFoundError:
        print(f"Error: The file '{yaml_file_path}' does not exist.")
        sys.exit(1)
    except Exception as e:
        print(f"An error occurred: {e}")
        sys.exit(1)